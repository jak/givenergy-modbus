import { EventEmitter } from 'events';
import { PollManager, type PollManagerOptions } from './poll-manager.js';
import { encodeWriteHoldingRegisterRequest } from './pdu/encode.js';
import { CHARGE_SLOT_REGISTERS, DISCHARGE_SLOT_REGISTERS } from './timeslot-registers.js';
import type { InverterSnapshot } from './model/inverter-snapshot.js';

export interface GivEnergyInverterOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;
}

export type InverterMode = 'normal' | 'eco' | 'grid_charge' | 'battery_discharge';

export class GivEnergyInverter extends EventEmitter {
  private readonly pollManager: PollManager;

  constructor(options: GivEnergyInverterOptions) {
    super();
    this.pollManager = new PollManager({
      host: options.host,
      port: options.port,
      pollIntervalMs: options.pollIntervalMs,
    });
    // Forward events from poll manager
    this.pollManager.on('data', (snapshot: InverterSnapshot) => this.emit('data', snapshot));
    this.pollManager.on('lost', (err: Error) => this.emit('lost', err));
    this.pollManager.on('debug', (msg: string) => this.emit('debug', msg));
  }

  getData(): InverterSnapshot {
    return this.pollManager.getData();
  }

  async start(): Promise<void> {
    return this.pollManager.start();
  }

  async stop(): Promise<void> {
    return this.pollManager.stop();
  }

  /**
   * Set a charge time slot.
   *
   * @param slot - 1 to 10 (charge slot number)
   * @param config - start/end times in "HH:MM" format, optional target SOC
   */
  async setChargeSlot(slot: number, config: { start: string; end: string; targetStateOfCharge?: number }): Promise<void> {
    const regs = CHARGE_SLOT_REGISTERS[slot - 1];
    if (!regs) throw new RangeError(`charge slot must be 1-10, got ${slot}`);
    validateTime(config.start);
    validateTime(config.end);
    await this.writeRegister(regs.start, timeToInt(config.start));
    await this.writeRegister(regs.end, timeToInt(config.end));
    if (config.targetStateOfCharge !== undefined) {
      validateStateOfCharge(config.targetStateOfCharge);
      await this.writeRegister(regs.targetStateOfCharge, config.targetStateOfCharge);
    }
  }

  /**
   * Set a discharge time slot.
   *
   * @param slot - 1 to 10 (discharge slot number)
   * @param config - start/end times in "HH:MM" format, optional target SOC
   */
  async setDischargeSlot(slot: number, config: { start: string; end: string; targetStateOfCharge?: number }): Promise<void> {
    const regs = DISCHARGE_SLOT_REGISTERS[slot - 1];
    if (!regs) throw new RangeError(`discharge slot must be 1-10, got ${slot}`);
    validateTime(config.start);
    validateTime(config.end);
    await this.writeRegister(regs.start, timeToInt(config.start));
    await this.writeRegister(regs.end, timeToInt(config.end));
    if (config.targetStateOfCharge !== undefined) {
      validateStateOfCharge(config.targetStateOfCharge);
      await this.writeRegister(regs.targetStateOfCharge, config.targetStateOfCharge);
    }
  }

  /**
   * Set inverter operating mode.
   */
  async setMode(mode: InverterMode): Promise<void> {
    // HR(27) = eco_mode: 1=normal, 2=eco, 0=demand
    const modeMap: Record<InverterMode, number> = {
      normal: 1,
      eco: 2,
      grid_charge: 4,
      battery_discharge: 0,
    };
    await this.writeRegister(27, modeMap[mode]);
  }

  /**
   * Set the legacy target state of charge for charging (HR 116).
   * On Gen2 inverters this is the only charge target. On Gen3, prefer
   * per-slot targets via setChargeSlot().
   *
   * @param percent - 4-100
   */
  async setTargetStateOfCharge(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(116, percent);
  }

  /**
   * Enable or disable charging. Controls HR(96).
   */
  async setEnableCharge(enabled: boolean): Promise<void> {
    await this.writeRegister(96, enabled ? 1 : 0);
  }

  /**
   * Enable or disable discharging. Controls HR(59).
   */
  async setEnableDischarge(enabled: boolean): Promise<void> {
    await this.writeRegister(59, enabled ? 1 : 0);
  }

  /**
   * Write a raw holding register value. Bypasses all validation.
   * Prefer the typed API methods (setChargeSlot, setMode, etc.) which
   * validate inputs and use the correct register addresses.
   *
   * @param register - holding register address
   * @param value - uint16 value to write
   */
  async unsafe_writeRegister(register: number, value: number): Promise<void> {
    return this.writeRegister(register, value);
  }

  private async writeRegister(register: number, value: number): Promise<void> {
    const client = (this.pollManager as any).client;
    const frame = encodeWriteHoldingRegisterRequest({
      dataAdapterSerial: (this.pollManager as any).dataAdapterSerial ?? '**********',
      slaveAddress: 0x11,
      register,
      value,
    });
    await client.sendRequest(frame);
  }
}

/** Convert "HH:MM" to integer HHMM (e.g. "04:30" -> 430) */
function timeToInt(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 100 + m;
}

function validateTime(time: string): void {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError(`invalid time format "${time}", expected "HH:MM"`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new RangeError(`invalid time "${time}", hour must be 0-23 and minute 0-59`);
}

function validateStateOfCharge(percent: number): void {
  if (!Number.isInteger(percent) || percent < 4 || percent > 100) {
    throw new RangeError(`state of charge must be an integer 4-100, got ${percent}`);
  }
}
