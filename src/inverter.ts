import { EventEmitter } from 'events';
import { PollManager, type PollManagerOptions } from './poll-manager.js';
import { encodeWriteHoldingRegisterRequest } from './pdu/encode.js';
import type { InverterSnapshot } from './model/inverter-snapshot.js';
import type { TimeSlot } from './model/register-types.js';

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
   * @param slot - 1 or 2 (charge slot number)
   * @param config - start/end times in "HH:MM" format, optional target SOC
   */
  async setChargeSlot(slot: 1 | 2, config: { start: string; end: string; targetStateOfCharge?: number }): Promise<void> {
    // Charge slot 1: HR(94)=start, HR(95)=end
    // Charge slot 2: HR(31)=start, HR(32)=end
    const [startReg, endReg] = slot === 1 ? [94, 95] : [31, 32];
    await this._writeRegister(startReg, timeToInt(config.start));
    await this._writeRegister(endReg, timeToInt(config.end));
    if (config.targetStateOfCharge !== undefined) {
      await this._writeRegister(116, config.targetStateOfCharge);
    }
  }

  /**
   * Set a discharge time slot.
   *
   * @param slot - 1 or 2 (discharge slot number)
   * @param config - start/end times in "HH:MM" format
   */
  async setDischargeSlot(slot: 1 | 2, config: { start: string; end: string }): Promise<void> {
    // Discharge slot 1: HR(56)=start, HR(57)=end
    // Discharge slot 2: HR(44)=start, HR(45)=end
    const [startReg, endReg] = slot === 1 ? [56, 57] : [44, 45];
    await this._writeRegister(startReg, timeToInt(config.start));
    await this._writeRegister(endReg, timeToInt(config.end));
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
    await this._writeRegister(27, modeMap[mode]);
  }

  /**
   * Set the target state of charge for charging.
   *
   * @param percent - 0-100
   */
  async setTargetStateOfCharge(percent: number): Promise<void> {
    await this._writeRegister(116, Math.max(0, Math.min(100, percent)));
  }

  private async _writeRegister(register: number, value: number): Promise<void> {
    // Access the client through the poll manager
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
