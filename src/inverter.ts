import { EventEmitter } from 'events';
import { PollManager, type PollManagerOptions } from './poll-manager.js';
import { encodeWriteHoldingRegisterRequest, encodeReadHoldingRegistersRequest } from './pdu/encode.js';
import { Client } from './client.js';
import { registersToString } from './model/converters.js';
import { detectModel } from './model/device-types.js';
import { detectGeneration, modelToGeneration, type InverterGeneration } from './generation.js';

import type { InverterSnapshot } from './model/inverter-snapshot.js';

export interface GivEnergyInverterOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;
  autoReconnect?: boolean;
  reconnectBackoffMs?: number;
  reconnectMaxBackoffMs?: number;
}

export type InverterMode = 'eco' | 'timed_demand' | 'timed_export';

export interface TimeSlotInput {
  start: string;
  end: string;
  targetStateOfCharge?: number;
}

export interface InverterIdentity {
  serialNumber: string;
  generation: InverterGeneration;
  modelCode: number;
}

export abstract class GivEnergyInverter extends EventEmitter {
  protected readonly pollManager: PollManager;

  protected constructor(pollManager: PollManager) {
    super();
    this.pollManager = pollManager;
    this.pollManager.on('data', (snapshot: InverterSnapshot) => this.emit('data', snapshot));
    this.pollManager.on('lost', (err: Error) => this.emit('lost', err));
    this.pollManager.on('debug', (msg: string) => this.emit('debug', msg));
    this.pollManager.on('reconnecting', (attempt: number, nextRetryMs: number) =>
      this.emit('reconnecting', attempt, nextRetryMs),
    );
    this.pollManager.on('reconnected', () => this.emit('reconnected'));
  }

  static async connect(options: GivEnergyInverterOptions): Promise<GivEnergyInverter> {
    const pollManager = new PollManager({
      host: options.host,
      port: options.port,
      pollIntervalMs: options.pollIntervalMs,
      autoReconnect: options.autoReconnect,
      reconnectBackoffMs: options.reconnectBackoffMs,
      reconnectMaxBackoffMs: options.reconnectMaxBackoffMs,
    });
    await pollManager.start();
    const snapshot = pollManager.getData();

    if (!snapshot.serialNumber || snapshot.serialNumber.replace(/[\x00\s]/g, '') === '') {
      await pollManager.stop();
      throw new Error(`No valid inverter found at ${options.host} (empty serial number)`);
    }

    const generation = snapshot.generation;

    switch (generation) {
      case 'gen3': {
        const { Gen3Inverter } = await import('./inverters/gen3.js');
        return new Gen3Inverter(pollManager);
      }
      case 'three_phase': {
        const { ThreePhaseInverter } = await import('./inverters/three-phase.js');
        return new ThreePhaseInverter(pollManager);
      }
      default: {
        const { Gen2Inverter } = await import('./inverters/gen2.js');
        return new Gen2Inverter(pollManager);
      }
    }
  }

  /**
   * Lightweight identity probe — reads only HR 0-59 (one Modbus request)
   * to extract serial number, model code, and generation without starting
   * a full poll cycle. Use this during pairing/discovery when you only need
   * to identify the inverter, not stream live data.
   */
  static async identify(options: { host: string; port?: number }): Promise<InverterIdentity> {
    const client = new Client({
      host: options.host,
      port: options.port ?? 8899,
      timeout: 10_000,
      retries: 1,
    });
    try {
      await client.connect();
      const frame = encodeReadHoldingRegistersRequest({
        dataAdapterSerial: client.dataAdapterSerial,
        slaveAddress: 0x11,
        baseRegister: 0,
        registerCount: 60,
      });
      const values = await client.sendRequest(frame);

      const serialRegs = [13, 14, 15, 16, 17].map(i => values[i] ?? 0);
      const serialNumber = registersToString(serialRegs);

      if (!serialNumber || serialNumber.replace(/[\x00\s]/g, '') === '') {
        throw new Error(`No valid inverter found at ${options.host} (empty serial number)`);
      }

      const modelCode = values[0] ?? 0;
      const armFirmwareVersion = values[21] ?? 0;
      const generation = modelCode !== 0
        ? modelToGeneration(detectModel(modelCode, armFirmwareVersion))
        : detectGeneration(serialNumber);

      return { serialNumber, generation, modelCode };
    } finally {
      await client.close();
    }
  }

  getData(): InverterSnapshot {
    return this.pollManager.getData();
  }

  async stop(): Promise<void> {
    return this.pollManager.stop();
  }

  // ── Shared control methods ──────────────────────────────────

  async setMode(mode: InverterMode): Promise<void> {
    switch (mode) {
      case 'eco':
        await this.writeRegister(27, 1);
        await this.writeRegister(59, 0);
        break;
      case 'timed_demand':
        await this.writeRegister(27, 1);
        await this.writeRegister(59, 1);
        break;
      case 'timed_export':
        await this.writeRegister(27, 0);
        await this.writeRegister(59, 1);
        break;
    }
  }

  async setDateTime(date: Date): Promise<void> {
    await this.writeRegister(35, date.getFullYear() - 2000);
    await this.writeRegister(36, date.getMonth() + 1);
    await this.writeRegister(37, date.getDate());
    await this.writeRegister(38, date.getHours());
    await this.writeRegister(39, date.getMinutes());
    await this.writeRegister(40, date.getSeconds());
  }

  async syncDateTime(): Promise<void> {
    await this.setDateTime(new Date());
  }

  async reboot(): Promise<void> {
    await this.writeRegister(163, 100);
  }

  async unsafe_writeRegister(register: number, value: number): Promise<void> {
    return this.writeRegister(register, value);
  }

  // ── Abstract methods (generation-specific) ──────────────────

  abstract setChargeScheduleEnabled(enabled: boolean): Promise<void>;
  abstract setDischargeScheduleEnabled(enabled: boolean): Promise<void>;
  abstract setChargeTarget(percent: number): Promise<void>;
  abstract setChargeSlot(slot: number, config: TimeSlotInput): Promise<void>;
  abstract setChargeSlots(configs: TimeSlotInput[]): Promise<void>;
  abstract setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void>;
  abstract setDischargeSlots(configs: TimeSlotInput[]): Promise<void>;
  abstract setChargeRate(watts: number): Promise<void>;
  abstract setChargeRatePercent(percent: number): Promise<void>;
  abstract setDischargeRate(watts: number): Promise<void>;
  abstract setDischargeRatePercent(percent: number): Promise<void>;
  abstract setBatteryReserve(percent: number): Promise<void>;
  abstract setBatteryPowerReserve(percent: number): Promise<void>;

  // ── Protected helpers ───────────────────────────────────────

  protected async writeRegister(register: number, value: number): Promise<void> {
    const client = (this.pollManager as any).client;
    const frame = encodeWriteHoldingRegisterRequest({
      dataAdapterSerial: client.dataAdapterSerial ?? '**********',
      slaveAddress: 0x11,
      register,
      value,
    });
    await client.sendRequest(frame);
  }
}

// ── Shared validation helpers (exported for subclasses) ────────

export function timeToInt(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 100 + m;
}

export function validateTime(time: string): void {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError(`invalid time format "${time}", expected "HH:MM"`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new RangeError(`invalid time "${time}", hour must be 0-23 and minute 0-59`);
}

export function validateStateOfCharge(percent: number): void {
  if (!Number.isInteger(percent) || percent < 4 || percent > 100) {
    throw new RangeError(`state of charge must be an integer 4-100, got ${percent}`);
  }
}

export function validateRatePercent(percent: number): void {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`rate percent must be an integer 0-100, got ${percent}`);
  }
}
