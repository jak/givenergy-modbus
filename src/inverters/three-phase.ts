import {
  GivEnergyInverter,
  type TimeSlotInput,
  validateTime,
  validateStateOfCharge,
  validateRatePercent,
  timeToInt,
} from '../inverter.js';

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
    validateTime(config.start);
    validateTime(config.end);
    if (slot === 1) {
      await this.writeRegister(1113, timeToInt(config.start));
      await this.writeRegister(1114, timeToInt(config.end));
    } else if (slot === 2) {
      await this.writeRegister(1115, timeToInt(config.start));
      await this.writeRegister(1116, timeToInt(config.end));
    } else {
      throw new RangeError(`Three-phase inverter supports charge slots 1-2, got ${slot}`);
    }
    // targetStateOfCharge silently ignored on 3ph (global target via setChargeTarget)
  }

  async setChargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 2) throw new RangeError(`Three-phase inverter supports 2 charge slots, got ${configs.length}`);
    await this.setChargeSlot(1, configs[0] ?? { start: '00:00', end: '00:00' });
    await this.setChargeSlot(2, configs[1] ?? { start: '00:00', end: '00:00' });
  }

  async setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    validateTime(config.start);
    validateTime(config.end);
    if (slot === 1) {
      await this.writeRegister(1118, timeToInt(config.start));
      await this.writeRegister(1119, timeToInt(config.end));
    } else if (slot === 2) {
      await this.writeRegister(1120, timeToInt(config.start));
      await this.writeRegister(1121, timeToInt(config.end));
    } else {
      throw new RangeError(`Three-phase inverter supports discharge slots 1-2, got ${slot}`);
    }
  }

  async setDischargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 2) throw new RangeError(`Three-phase inverter supports 2 discharge slots, got ${configs.length}`);
    await this.setDischargeSlot(1, configs[0] ?? { start: '00:00', end: '00:00' });
    await this.setDischargeSlot(2, configs[1] ?? { start: '00:00', end: '00:00' });
  }

  async setChargeRate(watts: number): Promise<void> {
    const percent = Math.round(Math.min(watts / 50, 100));
    await this.writeRegister(1110, Math.max(0, Math.min(percent, 100)));
  }

  async setChargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(1110, percent);
  }

  async setDischargeRate(watts: number): Promise<void> {
    const percent = Math.round(Math.min(watts / 50, 100));
    await this.writeRegister(1108, Math.max(0, Math.min(percent, 100)));
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
