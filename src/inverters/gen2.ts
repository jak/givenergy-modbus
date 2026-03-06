import {
  GivEnergyInverter,
  type TimeSlotInput,
  validateTime,
  validateStateOfCharge,
  validateRatePercent,
  timeToInt,
} from '../inverter.js';

export class Gen2Inverter extends GivEnergyInverter {
  async setChargeScheduleEnabled(enabled: boolean): Promise<void> {
    await this.writeRegister(96, enabled ? 1 : 0);
  }

  async setDischargeScheduleEnabled(enabled: boolean): Promise<void> {
    await this.writeRegister(59, enabled ? 1 : 0);
  }

  async setChargeTarget(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(116, percent);
  }

  async setChargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    if (slot !== 1) throw new RangeError(`Gen2 inverter supports charge slot 1 only, got ${slot}`);
    validateTime(config.start);
    validateTime(config.end);
    await this.writeRegister(94, timeToInt(config.start));
    await this.writeRegister(95, timeToInt(config.end));
    // targetStateOfCharge silently ignored on Gen2
  }

  async setChargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 1) throw new RangeError(`Gen2 inverter supports 1 charge slot, got ${configs.length}`);
    if (configs.length === 0) {
      await this.setChargeSlot(1, { start: '00:00', end: '00:00' });
      return;
    }
    await this.setChargeSlot(1, configs[0]);
  }

  async setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    validateTime(config.start);
    validateTime(config.end);
    if (slot === 1) {
      await this.writeRegister(56, timeToInt(config.start));
      await this.writeRegister(57, timeToInt(config.end));
    } else if (slot === 2) {
      await this.writeRegister(44, timeToInt(config.start));
      await this.writeRegister(45, timeToInt(config.end));
    } else {
      throw new RangeError(`Gen2 inverter supports discharge slots 1-2, got ${slot}`);
    }
  }

  async setDischargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 2) throw new RangeError(`Gen2 inverter supports 2 discharge slots, got ${configs.length}`);
    await this.setDischargeSlot(1, configs[0] ?? { start: '00:00', end: '00:00' });
    await this.setDischargeSlot(2, configs[1] ?? { start: '00:00', end: '00:00' });
  }

  async setChargeRate(watts: number): Promise<void> {
    if (watts < 0) throw new RangeError(`charge rate must be >= 0, got ${watts}`);
    const percent = Math.round(Math.min(watts / 100, 50));
    await this.writeRegister(111, Math.min(percent, 50));
  }

  async setChargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    // BATTERY_CHARGE_LIMIT_AC — also used by Gen1/Gen2
    await this.writeRegister(313, percent);
  }

  async setDischargeRate(watts: number): Promise<void> {
    if (watts < 0) throw new RangeError(`discharge rate must be >= 0, got ${watts}`);
    const percent = Math.round(Math.min(watts / 100, 50));
    await this.writeRegister(112, Math.min(percent, 50));
  }

  async setDischargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    // BATTERY_DISCHARGE_LIMIT_AC — also used by Gen1/Gen2
    await this.writeRegister(314, percent);
  }

  async setBatteryReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(110, percent);
  }

  async setBatteryPowerReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(114, percent);
  }
}
