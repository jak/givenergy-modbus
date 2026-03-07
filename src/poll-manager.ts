import { EventEmitter } from 'events';
import { Client } from './client.js';
import { buildSnapshot, type RegisterCache } from './snapshot-builder.js';
import {
  encodeReadHoldingRegistersRequest,
  encodeReadInputRegistersRequest,
  encodeReadMeterProductRegistersRequest,
} from './pdu/encode.js';
import type { InverterSnapshot } from './model/inverter-snapshot.js';
import type { InverterGeneration } from './generation.js';

export interface PollManagerOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;        // default 15000 (15s partial)
  fullRefreshIntervalMs?: number;  // default 60000 (60s full)
  autoReconnect?: boolean;         // default true
  reconnectBackoffMs?: number;     // initial backoff, default 5000
  reconnectMaxBackoffMs?: number;  // max backoff cap, default 300000 (5min)
}

const INVERTER_SLAVE = 0x11;
const BATTERY_REGISTER_START = 60;
const BATTERY_REGISTER_COUNT = 60;
const LV_BATTERY_SLAVES = [0x32, 0x33, 0x34, 0x35, 0x36, 0x37];
const METER_SLAVES = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
const METER_DATA_REGISTER_START = 60;
const METER_DATA_REGISTER_COUNT = 29; // IR 60-88
const METER_PRODUCT_REGISTER_START = 60;
const METER_PRODUCT_REGISTER_COUNT = 9; // MR 60-68

/**
 * Register ranges to read per poll cycle.
 *
 * GivEnergy inverter constraints:
 *  - Max 60 registers per request (enforced by the data adapter firmware)
 *  - Base register must be a multiple of 60
 *
 * Input register layout (non-contiguous — these are the only ranges we need):
 *  - 0..59:   real-time power, battery, grid, totals
 *  - 180..239: secondary energy totals (IR 180, 181)
 *
 * Holding register layout:
 *  - 0..59:   identity, time, discharge slot 1, enable discharge
 *  - 60..119: charge slots, enable charge, charge target SOC
 */
const INPUT_REGISTER_RANGES = [
  { base: 0,   count: 60 },
  { base: 180, count: 60 },
];

/** Pause between sequential register reads — matches GivTCP's 250ms inter-frame delay */
const INTER_READ_DELAY_MS = 250;

/** Time to wait after all reads for remaining push data to arrive */
const PUSH_DATA_SOAK_MS = 3000;

export class PollManager extends EventEmitter {
  private readonly client: Client;
  private readonly options: Required<PollManagerOptions>;
  private _cache: InverterSnapshot | null = null;
  private _started = false;
  private _failCount = 0;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _lastFullRefresh = 0;
  private _previousSnapshot: InverterSnapshot | null = null;
  private _polling = false;
  private _generation: InverterGeneration | null = null;

  // Register caches
  private _inputRegisters = new Map<number, number>();
  private _holdingRegisters = new Map<number, number>();
  private _batteryRegisters = new Map<number, Map<number, number>>();
  private _meterDataRegisters = new Map<number, Map<number, number>>();
  private _meterProductRegisters = new Map<number, Map<number, number>>();

  constructor(options: PollManagerOptions) {
    super();
    // Use ?? per-field so explicit `undefined` values don't override defaults
    this.options = {
      host: options.host,
      port: options.port ?? 8899,
      pollIntervalMs: options.pollIntervalMs ?? 15_000,
      fullRefreshIntervalMs: options.fullRefreshIntervalMs ?? 60_000,
      autoReconnect: options.autoReconnect ?? true,
      reconnectBackoffMs: options.reconnectBackoffMs ?? 5_000,
      reconnectMaxBackoffMs: options.reconnectMaxBackoffMs ?? 300_000,
    };
    this.client = new Client({
      host: this.options.host,
      port: this.options.port,
      timeout: 10_000, // 10s — inverter takes 4-8s to respond initially
      retries: 3,
      onDebug: (msg) => this.emit('debug', msg),
      // Accumulate ALL register data pushed by the inverter, whether or not it
      // matches a pending request. GivEnergy inverters enter "push mode" after
      // receiving requests and spontaneously send all register data in 60-reg
      // chunks. GivTCP's consumer task does the same: plant.update(message)
      // is called unconditionally for every response.
      onRegisterData: (slave, fc, base, values) => {
        if (slave === INVERTER_SLAVE) {
          const cache = fc === 4 ? this._inputRegisters : this._holdingRegisters;
          values.forEach((v, i) => cache.set(base + i, v));
          this.emit('debug', `accumulated push data: slave=0x${slave.toString(16)} fc=${fc} base=${base} count=${values.length}`);
        }
      },
    });
  }

  getData(): InverterSnapshot {
    if (!this._started || !this._cache) {
      throw new Error('not started');
    }
    return this._cache;
  }

  async start(): Promise<void> {
    this.emit('debug', `connecting to ${this.options.host}:${this.options.port}`);
    await this.client.connect();
    this.emit('debug', 'connected');
    this._started = true;
    await this._executePoll(true);
    this._pollTimer = setInterval(() => this._executePoll(false), this.options.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    await this.client.close();
    this._started = false;
  }

  /**
   * Read a single register range. Sends the request and waits for a matched
   * response. Even if the explicit response times out, the onRegisterData
   * callback may have already populated the cache from push data.
   */
  private async _readRange(
    type: 'input' | 'holding',
    base: number,
    count: number,
  ): Promise<void> {
    const encode = type === 'input' ? encodeReadInputRegistersRequest : encodeReadHoldingRegistersRequest;
    const label = type === 'input' ? 'input' : 'holding';
    this.emit('debug', `reading ${label} registers (slave=0x${INVERTER_SLAVE.toString(16)}, base=${base}, count=${count})`);
    const frame = encode({
      dataAdapterSerial: this.client.dataAdapterSerial,
      slaveAddress: INVERTER_SLAVE,
      baseRegister: base,
      registerCount: count,
    });
    try {
      const values = await this.client.sendRequest(frame);
      this.emit('debug', `${label} registers [${base}..${base + values.length - 1}] ok`);
    } catch (err) {
      // Not fatal — push data via onRegisterData may have already filled the cache.
      // Log the failure and continue.
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('debug', `${label} registers [${base}..${base + count - 1}] request failed: ${msg} (push data may have filled cache)`);
    }
  }

  private async _executePoll(fullRefresh = false): Promise<void> {
    if (this._polling) return;
    this._polling = true;
    const now = Date.now();
    const doFull = fullRefresh || (now - this._lastFullRefresh >= this.options.fullRefreshIntervalMs);

    try {
      // Send register reads SEQUENTIALLY with a 250ms inter-frame delay,
      // matching GivTCP's serial producer queue approach. Each request
      // independently retries on timeout. Even if some requests fail, the
      // onRegisterData callback accumulates all push data unconditionally.

      for (const { base, count } of INPUT_REGISTER_RANGES) {
        await this._readRange('input', base, count);
        await this._delay(INTER_READ_DELAY_MS);
      }

      const holdingRanges = this._holdingRanges(doFull);
      for (const { base, count } of holdingRanges) {
        await this._readRange('holding', base, count);
        await this._delay(INTER_READ_DELAY_MS);
      }

      // Wait for push data to settle. After receiving our requests, the inverter
      // enters push mode and spontaneously sends all register data in 60-reg
      // chunks. This soak period lets that data arrive and fill our caches.
      this.emit('debug', `waiting ${PUSH_DATA_SOAK_MS}ms for remaining push data...`);
      await this._delay(PUSH_DATA_SOAK_MS);

      if (doFull) {
        for (const slave of LV_BATTERY_SLAVES) {
          try {
            this.emit('debug', `reading battery registers (slave=0x${slave.toString(16)}, base=${BATTERY_REGISTER_START}, count=${BATTERY_REGISTER_COUNT})`);
            const batFrame = encodeReadInputRegistersRequest({
              dataAdapterSerial: this.client.dataAdapterSerial,
              slaveAddress: slave,
              baseRegister: BATTERY_REGISTER_START,
              registerCount: BATTERY_REGISTER_COUNT,
            });
            const batValues = await this.client.sendRequest(batFrame);
            this.emit('debug', `battery 0x${slave.toString(16)} ok (${batValues.length} values)`);
            const batCache = this._batteryRegisters.get(slave) ?? new Map<number, number>();
            batValues.forEach((v, i) => batCache.set(BATTERY_REGISTER_START + i, v));
            this._batteryRegisters.set(slave, batCache);
          } catch {
            this.emit('debug', `battery 0x${slave.toString(16)} did not respond, stopping battery scan`);
            break;
          }
        }
        // Scan meters on all 8 slaves — meters can be non-contiguous, so use
        // continue (not break) when one doesn't respond.
        for (const slave of METER_SLAVES) {
          try {
            this.emit('debug', `reading meter data (slave=0x${slave.toString(16)}, base=${METER_DATA_REGISTER_START}, count=${METER_DATA_REGISTER_COUNT})`);
            const dataFrame = encodeReadInputRegistersRequest({
              dataAdapterSerial: this.client.dataAdapterSerial,
              slaveAddress: slave,
              baseRegister: METER_DATA_REGISTER_START,
              registerCount: METER_DATA_REGISTER_COUNT,
            });
            const dataValues = await this.client.sendRequest(dataFrame);
            this.emit('debug', `meter 0x${slave.toString(16)} data ok (${dataValues.length} values)`);
            const dataCache = this._meterDataRegisters.get(slave) ?? new Map<number, number>();
            dataValues.forEach((v, i) => dataCache.set(METER_DATA_REGISTER_START + i, v));
            this._meterDataRegisters.set(slave, dataCache);

            // Read product info for meters that responded
            this.emit('debug', `reading meter product (slave=0x${slave.toString(16)}, base=${METER_PRODUCT_REGISTER_START}, count=${METER_PRODUCT_REGISTER_COUNT})`);
            const productFrame = encodeReadMeterProductRegistersRequest({
              dataAdapterSerial: this.client.dataAdapterSerial,
              slaveAddress: slave,
              baseRegister: METER_PRODUCT_REGISTER_START,
              registerCount: METER_PRODUCT_REGISTER_COUNT,
            });
            const productValues = await this.client.sendRequest(productFrame);
            this.emit('debug', `meter 0x${slave.toString(16)} product ok (${productValues.length} values)`);
            const productCache = this._meterProductRegisters.get(slave) ?? new Map<number, number>();
            productValues.forEach((v, i) => productCache.set(METER_PRODUCT_REGISTER_START + i, v));
            this._meterProductRegisters.set(slave, productCache);
          } catch {
            this.emit('debug', `meter 0x${slave.toString(16)} did not respond, continuing scan`);
            continue;
          }
        }

        this._lastFullRefresh = now;
      }

      // Build combined meter caches for snapshot builder
      const meterRegisterCaches = new Map<number, { data: Map<number, number>; product: Map<number, number> }>();
      for (const [slave, data] of this._meterDataRegisters) {
        const product = this._meterProductRegisters.get(slave) ?? new Map<number, number>();
        meterRegisterCaches.set(slave, { data, product });
      }

      const cache: RegisterCache = {
        inputRegisters: this._inputRegisters,
        holdingRegisters: this._holdingRegisters,
      };

      const snapshot = buildSnapshot(cache, {
        previousSnapshot: this._previousSnapshot,
        batteryRegisterCaches: this._batteryRegisters,
        meterRegisterCaches,
      });

      if (this._generation === null && snapshot !== null) {
        this._generation = snapshot.generation;
        this.emit('debug', `detected inverter generation: ${this._generation}`);
      }

      this._handlePollResult(snapshot, null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('debug', `poll failed: ${error.message}`);
      this._handlePollResult(null, error);
    } finally {
      this._polling = false;
    }
  }

  private _holdingRanges(full: boolean): Array<{base: number, count: number}> {
    const gen = this._generation ?? 'gen3'; // default to gen3 until detected
    if (gen === 'three_phase') {
      return full
        ? [{ base: 0, count: 60 }, { base: 60, count: 60 }, { base: 180, count: 60 }, { base: 1080, count: 60 }]
        : [{ base: 0, count: 60 }, { base: 180, count: 60 }, { base: 1080, count: 60 }];
    }
    if (gen === 'gen2') {
      return full
        ? [{ base: 0, count: 60 }, { base: 60, count: 60 }, { base: 180, count: 60 }]
        : [{ base: 0, count: 60 }, { base: 180, count: 60 }];
    }
    // gen3
    return full
      ? [{ base: 0, count: 60 }, { base: 60, count: 60 }, { base: 180, count: 60 }, { base: 240, count: 60 }]
      : [{ base: 0, count: 60 }, { base: 180, count: 60 }];
  }

  private _delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  _handlePollResult(snapshot: InverterSnapshot | null, err: Error | null): void {
    if (snapshot) {
      this._failCount = 0;
      this._previousSnapshot = snapshot;
      this._cache = snapshot;
      this.emit('data', snapshot);
    } else {
      this._failCount++;
      if (this._failCount >= 10) {
        this.emit('lost', err ?? new Error('too many consecutive failures'));
      }
    }
  }
}
