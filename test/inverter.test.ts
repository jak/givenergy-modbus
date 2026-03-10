import { describe, it, expect, vi } from 'vitest';
import { GivEnergyInverter } from '../src/inverter.js';
import { Gen2Inverter } from '../src/inverters/gen2.js';
import { Gen3Inverter } from '../src/inverters/gen3.js';
import { ThreePhaseInverter } from '../src/inverters/three-phase.js';
import { PollManager } from '../src/poll-manager.js';

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

  it('connect() throws when initial poll produces empty serial number (#23)', async () => {
    // When connecting to a host that has port 8899 open but is not a GivEnergy
    // inverter, the poll completes with all-zero registers producing an empty
    // serial number. connect() should reject rather than returning a bogus inverter.
    const origStart = vi.spyOn(PollManager.prototype, 'start').mockResolvedValue(undefined);
    const origGetData = vi.spyOn(PollManager.prototype, 'getData').mockReturnValue({
      generation: 'gen2',
      serialNumber: '',
      modelCode: 0,
      solarPower: 0,
      pvString1Power: 0,
      pvString2Power: 0,
      batteryPower: 0,
      gridPower: 0,
      loadPower: 0,
      inverterOutputPower: 0,
      gridApparentPower: 0,
      epsBackupPower: 0,
      pvString1Voltage: 0,
      pvString2Voltage: 0,
      pvString1Current: 0,
      pvString2Current: 0,
      stateOfCharge: 0,
      batteryVoltage: 0,
      batteryCurrent: 0,
      gridVoltage: 0,
      gridFrequency: 0,
      inverterCurrent: 0,
      epsBackupVoltage: 0,
      epsBackupFrequency: 0,
      inverterHeatsinkTemp: 0,
      chargerTemperature: 0,
      batteryTemperature: 0,
      pvEnergyTotalKwh: 0,
      batteryChargeEnergyTotalKwh: 0,
      batteryDischargeEnergyTotalKwh: 0,
      gridImportEnergyTotalKwh: 0,
      gridExportEnergyTotalKwh: 0,
      consumptionEnergyTotalKwh: 0,
      batteryThroughputTotalKwh: 0,
      hoursOfOperation: 0,
      pvEnergyTodayKwh: 0,
      batteryChargeEnergyTodayKwh: 0,
      batteryDischargeEnergyTodayKwh: 0,
      gridImportEnergyTodayKwh: 0,
      gridExportEnergyTodayKwh: 0,
      consumptionEnergyTodayKwh: 0,
      chargeSlots: [],
      dischargeSlots: [],
      enableCharge: false,
      enableDischarge: false,
      chargeTargetStateOfCharge: 0,
      systemTime: new Date(),
      powerFlows: {
        solarToHouse: 0, solarToBattery: 0, solarToGrid: 0,
        batteryToHouse: 0, batteryToGrid: 0, gridToHouse: 0, gridToBattery: 0,
      },
      batteries: [],
      meters: [],
    } as any);
    const origStop = vi.spyOn(PollManager.prototype, 'stop').mockResolvedValue(undefined);

    try {
      await expect(GivEnergyInverter.connect({ host: '192.168.50.118' }))
        .rejects.toThrow('No valid inverter found');
    } finally {
      origStart.mockRestore();
      origGetData.mockRestore();
      origStop.mockRestore();
    }
  });

  it('connect() throws when serial is NUL-filled from all-zero registers', async () => {
    // registersToString converts all-zero registers to NUL bytes (\x00),
    // which trim() does NOT strip. This is the common case when a non-inverter
    // device has port 8899 open — registers read as zeros, producing NUL-filled serial.
    const origStart = vi.spyOn(PollManager.prototype, 'start').mockResolvedValue(undefined);
    const origGetData = vi.spyOn(PollManager.prototype, 'getData').mockReturnValue({
      generation: 'gen2',
      serialNumber: '\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
      modelCode: 0,
      solarPower: 0, pvString1Power: 0, pvString2Power: 0,
      batteryPower: 0, gridPower: 0, loadPower: 0,
      inverterOutputPower: 0, gridApparentPower: 0, epsBackupPower: 0,
      pvString1Voltage: 0, pvString2Voltage: 0,
      pvString1Current: 0, pvString2Current: 0,
      stateOfCharge: 0, batteryVoltage: 0, batteryCurrent: 0,
      gridVoltage: 0, gridFrequency: 0, inverterCurrent: 0,
      epsBackupVoltage: 0, epsBackupFrequency: 0,
      inverterHeatsinkTemp: 0, chargerTemperature: 0, batteryTemperature: 0,
      pvEnergyTotalKwh: 0, batteryChargeEnergyTotalKwh: 0,
      batteryDischargeEnergyTotalKwh: 0, gridImportEnergyTotalKwh: 0,
      gridExportEnergyTotalKwh: 0, consumptionEnergyTotalKwh: 0,
      batteryThroughputTotalKwh: 0, hoursOfOperation: 0,
      pvEnergyTodayKwh: 0, batteryChargeEnergyTodayKwh: 0,
      batteryDischargeEnergyTodayKwh: 0, gridImportEnergyTodayKwh: 0,
      gridExportEnergyTodayKwh: 0, consumptionEnergyTodayKwh: 0,
      chargeSlots: [], dischargeSlots: [],
      enableCharge: false, enableDischarge: false, chargeTargetStateOfCharge: 0,
      systemTime: new Date(),
      powerFlows: {
        solarToHouse: 0, solarToBattery: 0, solarToGrid: 0,
        batteryToHouse: 0, batteryToGrid: 0, gridToHouse: 0, gridToBattery: 0,
      },
      batteries: [], meters: [],
    } as any);
    const origStop = vi.spyOn(PollManager.prototype, 'stop').mockResolvedValue(undefined);

    try {
      await expect(GivEnergyInverter.connect({ host: '192.168.50.118' }))
        .rejects.toThrow('No valid inverter found');
    } finally {
      origStart.mockRestore();
      origGetData.mockRestore();
      origStop.mockRestore();
    }
  });

  it('all subclasses extend GivEnergyInverter', () => {
    expect(Gen2Inverter.prototype).toBeInstanceOf(GivEnergyInverter);
    expect(Gen3Inverter.prototype).toBeInstanceOf(GivEnergyInverter);
    expect(ThreePhaseInverter.prototype).toBeInstanceOf(GivEnergyInverter);
  });
});
