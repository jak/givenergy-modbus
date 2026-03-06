import {
  GivEnergyInverter,
  type TimeSlotInput,
  validateTime,
  validateStateOfCharge,
  validateRatePercent,
  timeToInt,
} from '../inverter.js';
import { THREE_PHASE_CHARGE_SLOT_REGISTERS, THREE_PHASE_DISCHARGE_SLOT_REGISTERS } from '../timeslot-registers.js';

export class ThreePhaseInverter extends GivEnergyInverter {
  async setChargeScheduleEnabled(enabled: boolean): Promise<void> {
    const val = enabled ? 1 : 0;
    await this.writeRegister(1123, val);
    await this.writeRegister(1112, val);
  }

  async setDischargeScheduleEnabled(enabled: boolean): Promise<void> {
    await this.writeRegister(1122, enabled ? 1 : 0);
  }

  async setChargeTarget(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(1111, percent);
  }

  async setChargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    if (slot < 1 || slot > 2) throw new RangeError(`Three-phase inverter supports charge slots 1-2, got ${slot}`);
    validateTime(config.start);
    validateTime(config.end);
    const regs = THREE_PHASE_CHARGE_SLOT_REGISTERS[slot - 1];
    await this.writeRegister(regs.start, timeToInt(config.start));
    await this.writeRegister(regs.end, timeToInt(config.end));
    // targetStateOfCharge silently ignored on 3ph (global target via setChargeTarget)
  }

  async setChargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 2) throw new RangeError(`Three-phase inverter supports 2 charge slots, got ${configs.length}`);
    await this.setChargeSlot(1, configs[0] ?? { start: '00:00', end: '00:00' });
    await this.setChargeSlot(2, configs[1] ?? { start: '00:00', end: '00:00' });
  }

  async setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    if (slot < 1 || slot > 2) throw new RangeError(`Three-phase inverter supports discharge slots 1-2, got ${slot}`);
    validateTime(config.start);
    validateTime(config.end);
    const regs = THREE_PHASE_DISCHARGE_SLOT_REGISTERS[slot - 1];
    await this.writeRegister(regs.start, timeToInt(config.start));
    await this.writeRegister(regs.end, timeToInt(config.end));
  }

  async setDischargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 2) throw new RangeError(`Three-phase inverter supports 2 discharge slots, got ${configs.length}`);
    await this.setDischargeSlot(1, configs[0] ?? { start: '00:00', end: '00:00' });
    await this.setDischargeSlot(2, configs[1] ?? { start: '00:00', end: '00:00' });
  }

  async setChargeRate(watts: number): Promise<void> {
    if (watts < 0) throw new RangeError(`charge rate must be >= 0, got ${watts}`);
    const percent = Math.round(Math.min(watts / 50, 100));
    await this.writeRegister(1110, Math.min(percent, 100));
  }

  async setChargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(1110, percent);
  }

  async setDischargeRate(watts: number): Promise<void> {
    if (watts < 0) throw new RangeError(`discharge rate must be >= 0, got ${watts}`);
    const percent = Math.round(Math.min(watts / 50, 100));
    await this.writeRegister(1108, Math.min(percent, 100));
  }

  async setDischargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(1108, percent);
  }

  async setBatteryReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(1109, percent);
  }

  async setBatteryPowerReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(1078, percent);
  }
}
