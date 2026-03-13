import {
  GivEnergyInverter,
  type TimeSlotInput,
  validateTime,
  validateStateOfCharge,
  validateRatePercent,
  timeToInt,
} from '../inverter.js';
import type { BatteryPauseMode } from '../model/inverter-snapshot.js';
import { CHARGE_SLOT_REGISTERS, DISCHARGE_SLOT_REGISTERS } from '../timeslot-registers.js';

const PAUSE_MODE_VALUES: Record<BatteryPauseMode, number> = {
  disabled: 0,
  pause_charge: 1,
  pause_discharge: 2,
  pause_both: 3,
};

export class Gen3Inverter extends GivEnergyInverter {
  async setTimedCharge(enabled: boolean): Promise<void> {
    await this.writeRegister(96, enabled ? 1 : 0);
  }

  async setBatteryPauseMode(mode: BatteryPauseMode): Promise<void> {
    await this.writeRegister(318, PAUSE_MODE_VALUES[mode]);
  }

  async setTimedDischarge(enabled: boolean): Promise<void> {
    await this.setBatteryPauseMode(enabled ? 'pause_discharge' : 'disabled');
  }

  async setChargeTarget(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(116, percent);
  }

  async setChargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
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

  async setChargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 10) throw new RangeError(`Gen3 inverter supports 10 charge slots, got ${configs.length}`);
    for (let i = 0; i < 10; i++) {
      if (i < configs.length) {
        await this.setChargeSlot(i + 1, configs[i]);
      } else {
        await this.setChargeSlot(i + 1, { start: '00:00', end: '00:00' });
      }
    }
  }

  async setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
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

  async setDischargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 10) throw new RangeError(`Gen3 inverter supports 10 discharge slots, got ${configs.length}`);
    for (let i = 0; i < 10; i++) {
      if (i < configs.length) {
        await this.setDischargeSlot(i + 1, configs[i]);
      } else {
        await this.setDischargeSlot(i + 1, { start: '00:00', end: '00:00' });
      }
    }
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

  // ── Gen3-only ──────────────────────────────────────────────

  async setExportLimit(watts: number): Promise<void> {
    if (watts < 0 || watts > 65000) throw new RangeError(`export limit must be 0-65000, got ${watts}`);
    await this.writeRegister(2071, watts);
  }

  async setTimedDischargeSlot(config: { start: string; end: string }): Promise<void> {
    validateTime(config.start);
    validateTime(config.end);
    // Under the hood HR(319-320) are battery pause slot registers.
    // The app shows the inverse: start/end of when discharge is *allowed*.
    // So we swap: discharge start → HR(320), discharge end → HR(319).
    await this.writeRegister(320, timeToInt(config.start));
    await this.writeRegister(319, timeToInt(config.end));
  }
}
