import { describe, it, expect } from 'vitest';
import { GivEnergyInverter } from '../src/inverter.js';
import { Gen2Inverter } from '../src/inverters/gen2.js';
import { Gen3Inverter } from '../src/inverters/gen3.js';
import { ThreePhaseInverter } from '../src/inverters/three-phase.js';

describe('GivEnergyInverter', () => {
  it('exposes a static connect() factory method', () => {
    expect(typeof GivEnergyInverter.connect).toBe('function');
  });

  it('exposes shared control methods on prototype', () => {
    // Verify method signatures exist on the abstract class prototype
    // (subclasses inherit these shared methods)
    expect(typeof GivEnergyInverter.prototype.setMode).toBe('function');
    expect(typeof GivEnergyInverter.prototype.setDateTime).toBe('function');
    expect(typeof GivEnergyInverter.prototype.syncDateTime).toBe('function');
    expect(typeof GivEnergyInverter.prototype.reboot).toBe('function');
    expect(typeof GivEnergyInverter.prototype.stop).toBe('function');
    expect(typeof GivEnergyInverter.prototype.getData).toBe('function');
    expect(typeof GivEnergyInverter.prototype.unsafe_writeRegister).toBe('function');
  });

  it('Gen2Inverter exposes generation-specific methods', () => {
    expect(typeof Gen2Inverter.prototype.setChargeScheduleEnabled).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeScheduleEnabled).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeTarget).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeSlot).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeSlots).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeSlot).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeSlots).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeRate).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeRatePercent).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeRate).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeRatePercent).toBe('function');
    expect(typeof Gen2Inverter.prototype.setBatteryReserve).toBe('function');
    expect(typeof Gen2Inverter.prototype.setBatteryPowerReserve).toBe('function');
  });

  it('Gen3Inverter exposes generation-specific methods including Gen3-only', () => {
    expect(typeof Gen3Inverter.prototype.setChargeScheduleEnabled).toBe('function');
    expect(typeof Gen3Inverter.prototype.setChargeSlot).toBe('function');
    expect(typeof Gen3Inverter.prototype.setExportLimit).toBe('function');
    expect(typeof Gen3Inverter.prototype.setBatteryPauseMode).toBe('function');
    expect(typeof Gen3Inverter.prototype.setPauseSlot).toBe('function');
  });

  it('ThreePhaseInverter exposes generation-specific methods', () => {
    expect(typeof ThreePhaseInverter.prototype.setChargeScheduleEnabled).toBe('function');
    expect(typeof ThreePhaseInverter.prototype.setChargeSlot).toBe('function');
    expect(typeof ThreePhaseInverter.prototype.setDischargeSlot).toBe('function');
  });

  it('all subclasses extend GivEnergyInverter', () => {
    expect(Gen2Inverter.prototype).toBeInstanceOf(GivEnergyInverter);
    expect(Gen3Inverter.prototype).toBeInstanceOf(GivEnergyInverter);
    expect(ThreePhaseInverter.prototype).toBeInstanceOf(GivEnergyInverter);
  });
});
