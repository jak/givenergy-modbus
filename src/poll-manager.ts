import { EventEmitter } from 'events';
import { Client } from './client.js';
import { buildSnapshot, type RegisterCache } from './snapshot-builder.js';
import { encodeReadHoldingRegistersRequest, encodeReadInputRegistersRequest } from './pdu/encode.js';
import type { InverterSnapshot } from './model/inverter-snapshot.js';

export interface PollManagerOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;      // default 15000 (15s partial)
  fullRefreshIntervalMs?: number; // default 60000 (60s full)
}

const INVERTER_SLAVE = 0x11;
const INPUT_REGISTER_START = 0;
const INPUT_REGISTER_COUNT = 120;
const HOLDING_REGISTER_START = 0;
const HOLDING_REGISTER_COUNT = 120;
const BATTERY_REGISTER_START = 60;
const BATTERY_REGISTER_COUNT = 60;
const LV_BATTERY_SLAVES = [0x32, 0x33, 0x34, 0x35, 0x36, 0x37];

export class PollManager extends EventEmitter {
  private readonly client: Client;
  private readonly options: Required<PollManagerOptions>;
  private _cache: InverterSnapshot | null = null;
  private _started = false;
  private _failCount = 0;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _lastFullRefresh = 0;
  private _previousSnapshot: InverterSnapshot | null = null;

  // Register caches
  private _inputRegisters = new Map<number, number>();
  private _holdingRegisters = new Map<number, number>();
  private _batteryRegisters = new Map<number, Map<number, number>>();

  constructor(options: PollManagerOptions) {
    super();
    this.options = {
      port: 8899,
      pollIntervalMs: 15_000,
      fullRefreshIntervalMs: 60_000,
      ...options,
    };
    this.client = new Client({
      host: this.options.host,
      port: this.options.port,
    });
  }

  getData(): InverterSnapshot {
    if (!this._started || !this._cache) {
      throw new Error('not started');
    }
    return this._cache;
  }

  async start(): Promise<void> {
    await this.client.connect();
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

  private async _executePoll(fullRefresh = false): Promise<void> {
    const now = Date.now();
    const doFull = fullRefresh || (now - this._lastFullRefresh >= this.options.fullRefreshIntervalMs);

    try {
      // Read input registers
      const irFrame = encodeReadInputRegistersRequest({
        dataAdapterSerial: '**********',
        slaveAddress: INVERTER_SLAVE,
        baseRegister: INPUT_REGISTER_START,
        registerCount: INPUT_REGISTER_COUNT,
      });
      const irValues = await this.client.sendRequest(irFrame);
      irValues.forEach((v, i) => this._inputRegisters.set(INPUT_REGISTER_START + i, v));

      if (doFull) {
        // Read holding registers
        const hrFrame = encodeReadHoldingRegistersRequest({
          dataAdapterSerial: '**********',
          slaveAddress: INVERTER_SLAVE,
          baseRegister: HOLDING_REGISTER_START,
          registerCount: HOLDING_REGISTER_COUNT,
        });
        const hrValues = await this.client.sendRequest(hrFrame);
        hrValues.forEach((v, i) => this._holdingRegisters.set(HOLDING_REGISTER_START + i, v));

        // Read battery registers
        for (const slave of LV_BATTERY_SLAVES) {
          try {
            const batFrame = encodeReadInputRegistersRequest({
              dataAdapterSerial: '**********',
              slaveAddress: slave,
              baseRegister: BATTERY_REGISTER_START,
              registerCount: BATTERY_REGISTER_COUNT,
            });
            const batValues = await this.client.sendRequest(batFrame);
            const batCache = this._batteryRegisters.get(slave) ?? new Map<number, number>();
            batValues.forEach((v, i) => batCache.set(BATTERY_REGISTER_START + i, v));
            this._batteryRegisters.set(slave, batCache);
          } catch {
            break; // Stop scanning at first non-responding battery
          }
        }

        this._lastFullRefresh = now;
      }

      const cache: RegisterCache = {
        inputRegisters: this._inputRegisters,
        holdingRegisters: this._holdingRegisters,
      };

      const snapshot = buildSnapshot(cache, {
        previousSnapshot: this._previousSnapshot,
        batteryRegisterCaches: this._batteryRegisters,
      });

      this._handlePollResult(snapshot, null);
    } catch (err) {
      this._handlePollResult(null, err instanceof Error ? err : new Error(String(err)));
    }
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
