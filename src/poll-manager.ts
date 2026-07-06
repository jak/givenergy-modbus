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
import { detectModel, isHighVoltage } from './model/device-types.js';
import type { DeviceType } from './model/device-types.js';

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
/** BAMS (Battery Aggregation & Management System) slave address — reports BCU count */
const BAMS_SLAVE = 0xa0;
/** BAMS register containing number of BCUs */
const BAMS_NUMBER_OF_BCUS_REGISTER = 61;
/** BCU (Battery Control Unit) base slave address — BCU N is at 0x70 + N */
const BCU_BASE_SLAVE = 0x70;
/** BCU register containing number of BMUs (modules) in this BCU */
const BCU_NUMBER_OF_MODULES_REGISTER = 64;
/** BMU (Battery Module Unit) base slave address — BMU N is at 0x50 + N */
const BMU_BASE_SLAVE = 0x50;
/** BMU register read count — 60 registers per module */
const BMU_REGISTER_COUNT = 60;
/** BMU base register offset multiplier — each BCU adds 120 to the base */
const BMU_BCU_OFFSET = 120;
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
 *  - 4080..4139: 32-bit battery energy totals (#8)
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
  private _reconnecting = false;
  private _reconnectAbort = false;
  private _deviceType: DeviceType | null = null;
  private _bcuList: Array<{ bcuIndex: number; moduleCount: number }> = [];

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
    this._reconnectAbort = true;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    await this.client.close();
    this._started = false;
    this._reconnecting = false;
  }

  /**
   * Read a single register range. Returns true if the inverter sent a live matched
   * response, false if the request failed. A failure is NOT fatal on its own — push
   * data via onRegisterData may have already filled the cache — but the caller uses
   * the return value to tell a live connection (some response arrived) apart from a
   * dead one (every read failed), which is what drives reconnect detection.
   */
  private async _readRange(
    type: 'input' | 'holding',
    base: number,
    count: number,
  ): Promise<boolean> {
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
      return true;
    } catch (err) {
      // Not fatal — push data via onRegisterData may have already filled the cache.
      // Log the failure and continue.
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('debug', `${label} registers [${base}..${base + count - 1}] request failed: ${msg} (push data may have filled cache)`);
      return false;
    }
  }

  /**
   * Read input registers from a battery/BCU/BMU slave.
   * Returns the register values, or null on failure.
   */
  private async _readSlaveRegisters(
    slaveAddress: number,
    baseRegister: number,
    registerCount: number,
  ): Promise<number[] | null> {
    const frame = encodeReadInputRegistersRequest({
      dataAdapterSerial: this.client.dataAdapterSerial,
      slaveAddress,
      baseRegister,
      registerCount,
    });
    try {
      return await this.client.sendRequest(frame);
    } catch {
      return null;
    }
  }

  /**
   * Scan HV battery hierarchy: BAMS → BCU → BMU.
   *
   * 1. Read BAMS at 0xA0 to discover BCU count
   * 2. Read each BCU at 0x70+N for pack data and module count
   * 3. Read each BMU at 0x50+N with base register offset per BCU
   */
  private async _scanHvBatteries(): Promise<void> {
    // Step 1: Read BAMS to discover BCU count
    this.emit('debug', `reading BAMS (slave=0x${BAMS_SLAVE.toString(16)}, base=${BATTERY_REGISTER_START}, count=5)`);
    const bamsValues = await this._readSlaveRegisters(BAMS_SLAVE, BATTERY_REGISTER_START, 5);
    if (!bamsValues) {
      this.emit('debug', 'BAMS did not respond, skipping HV battery scan');
      return;
    }
    const numberOfBcus = bamsValues[BAMS_NUMBER_OF_BCUS_REGISTER - BATTERY_REGISTER_START] ?? 0;
    this.emit('debug', `BAMS reports ${numberOfBcus} BCU(s)`);

    if (numberOfBcus === 0) return;

    this._bcuList = [];

    // Step 2: Read each BCU
    for (let bcuIndex = 0; bcuIndex < numberOfBcus; bcuIndex++) {
      const bcuSlave = BCU_BASE_SLAVE + bcuIndex;
      this.emit('debug', `reading BCU ${bcuIndex} (slave=0x${bcuSlave.toString(16)}, base=${BATTERY_REGISTER_START}, count=${BATTERY_REGISTER_COUNT})`);
      const bcuValues = await this._readSlaveRegisters(bcuSlave, BATTERY_REGISTER_START, BATTERY_REGISTER_COUNT);
      await this._delay(INTER_READ_DELAY_MS);

      if (!bcuValues) {
        this.emit('debug', `BCU ${bcuIndex} did not respond, continuing scan`);
        continue;
      }

      // Store BCU registers
      const bcuCache = new Map<number, number>();
      bcuValues.forEach((v, i) => bcuCache.set(BATTERY_REGISTER_START + i, v));
      this._batteryRegisters.set(bcuSlave, bcuCache);

      const moduleCount = bcuValues[BCU_NUMBER_OF_MODULES_REGISTER - BATTERY_REGISTER_START] ?? 0;
      this.emit('debug', `BCU ${bcuIndex} has ${moduleCount} module(s)`);
      this._bcuList.push({ bcuIndex, moduleCount });

      // Step 3: Read each BMU for this BCU
      for (let bmuIndex = 0; bmuIndex < moduleCount; bmuIndex++) {
        const bmuSlave = BMU_BASE_SLAVE + bmuIndex;
        const bmuBase = BATTERY_REGISTER_START + (BMU_BCU_OFFSET * bcuIndex);
        this.emit('debug', `reading BMU ${bmuIndex} (slave=0x${bmuSlave.toString(16)}, base=${bmuBase}, count=${BMU_REGISTER_COUNT})`);
        const bmuValues = await this._readSlaveRegisters(bmuSlave, bmuBase, BMU_REGISTER_COUNT);
        await this._delay(INTER_READ_DELAY_MS);

        if (!bmuValues) {
          this.emit('debug', `BMU ${bmuIndex} did not respond, continuing scan for BCU ${bcuIndex}`);
          continue;
        }

        // Store BMU registers normalized to base 60 for consistent snapshot building.
        // The BCU offset only affects the Modbus request addressing, not the register layout.
        const bmuKey = (bcuIndex << 8) | bmuIndex;
        const bmuCache = new Map<number, number>();
        bmuValues.forEach((v, i) => bmuCache.set(BATTERY_REGISTER_START + i, v));
        this._batteryRegisters.set(bmuKey, bmuCache);

        this.emit('debug', `BMU ${bmuIndex} ok (${bmuValues.length} values)`);
      }
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

      // Track whether the inverter answered any read this cycle. If every read fails
      // the transport is dead — but a stale snapshot is still buildable from the cached
      // registers, so without this signal _failCount would keep resetting to 0 and the
      // reconnect loop would never fire. See _handlePollResult below.
      let liveResponses = 0;

      for (const { base, count } of INPUT_REGISTER_RANGES) {
        if (await this._readRange('input', base, count)) liveResponses++;
        await this._delay(INTER_READ_DELAY_MS);
      }

      const holdingRanges = this._holdingRanges(doFull);
      for (const { base, count } of holdingRanges) {
        if (await this._readRange('holding', base, count)) liveResponses++;
        await this._delay(INTER_READ_DELAY_MS);
      }

      // Wait for push data to settle. After receiving our requests, the inverter
      // enters push mode and spontaneously sends all register data in 60-reg
      // chunks. This soak period lets that data arrive and fill our caches.
      this.emit('debug', `waiting ${PUSH_DATA_SOAK_MS}ms for remaining push data...`);
      await this._delay(PUSH_DATA_SOAK_MS);

      if (doFull) {
        // Detect device type for HV vs LV battery scanning
        if (this._deviceType === null) {
          const modelCode = this._holdingRegisters.get(0) ?? 0;
          const armFw = this._holdingRegisters.get(21) ?? 0;
          if (modelCode !== 0) {
            this._deviceType = detectModel(modelCode, armFw);
            this.emit('debug', `detected device type: ${this._deviceType} (HV: ${isHighVoltage(this._deviceType)})`);
          }
        }

        // Clear previous battery data for full refresh
        this._batteryRegisters.clear();

        if (this._deviceType !== null && isHighVoltage(this._deviceType)) {
          await this._scanHvBatteries();
        } else {
          // LV battery scan — batteries can be non-contiguous (#6)
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
              this.emit('debug', `battery 0x${slave.toString(16)} did not respond, continuing scan`);
              continue;
            }
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
        isHighVoltage: this._deviceType !== null && isHighVoltage(this._deviceType),
        bcuList: this._bcuList,
      });

      // A cycle where the inverter answered nothing means the transport is dead, even
      // though buildSnapshot() can still assemble a stale snapshot from cached registers.
      // Count it as a failed poll so _failCount climbs toward the reconnect threshold.
      if (liveResponses === 0) {
        this.emit('debug', 'no live response from inverter this cycle — treating poll as failed');
        this._handlePollResult(null, new Error('no response from inverter'));
        return;
      }

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
    // HR(4080-4139) contains 32-bit battery energy totals that don't overflow (#8)
    if (gen === 'three_phase') {
      return full
        ? [{ base: 0, count: 60 }, { base: 60, count: 60 }, { base: 180, count: 60 }, { base: 1080, count: 60 }]
        : [{ base: 0, count: 60 }, { base: 180, count: 60 }, { base: 1080, count: 60 }];
    }
    if (gen === 'gen2') {
      return full
        ? [{ base: 0, count: 60 }, { base: 60, count: 60 }, { base: 180, count: 60 }, { base: 4080, count: 60 }]
        : [{ base: 0, count: 60 }, { base: 180, count: 60 }, { base: 4080, count: 60 }];
    }
    // gen3 — includes HR 300-359 for timed discharge toggle at HR(318) (#31)
    return full
      ? [{ base: 0, count: 60 }, { base: 60, count: 60 }, { base: 180, count: 60 }, { base: 240, count: 60 }, { base: 300, count: 60 }, { base: 4080, count: 60 }]
      : [{ base: 0, count: 60 }, { base: 180, count: 60 }, { base: 4080, count: 60 }];
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
      if (this._failCount >= 10 && !this._reconnecting) {
        this.emit('lost', err ?? new Error('too many consecutive failures'));
        if (this.options.autoReconnect) {
          if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
          }
          this._reconnectLoop();
        }
      }
    }
  }

  private async _reconnectLoop(): Promise<void> {
    this._reconnecting = true;
    let attempt = 0;
    let backoff = this.options.reconnectBackoffMs;

    while (!this._reconnectAbort) {
      attempt++;
      this.emit('reconnecting', attempt, backoff);
      this.emit('debug', `reconnect attempt ${attempt}, waiting ${backoff}ms`);

      await this._delay(backoff);
      if (this._reconnectAbort) break;

      try {
        await this.client.close();
        await this.client.connect();
        // Try a full poll to confirm the connection works
        await this._executePoll(true);

        if (this._cache && this._failCount === 0) {
          this.emit('debug', 'reconnected successfully');
          this.emit('reconnected');
          this._reconnecting = false;
          this._failCount = 0;
          this._pollTimer = setInterval(
            () => this._executePoll(false),
            this.options.pollIntervalMs,
          );
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit('debug', `reconnect attempt ${attempt} failed: ${msg}`);
      }

      backoff = Math.min(backoff * 2, this.options.reconnectMaxBackoffMs);
    }

    this._reconnecting = false;
  }
}
