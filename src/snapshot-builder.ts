/**
 * Snapshot builder — assembles a structured InverterSnapshot from raw register caches.
 *
 * Applies all GivEnergy protocol quirks: sanity checking, SOC fallback,
 * time fallback, frequency scaling, and energy register fallback.
 *
 * Reference: GivTCP/read.py — processInverterInfo()
 */

import type { InverterSnapshot } from './model/inverter-snapshot.js';
import type { BatterySnapshot } from './model/battery-snapshot.js';
import type { MeterSnapshot } from './model/meter-snapshot.js';
import type { TimeSlot, TimeSlotConfig } from './model/register-types.js';
import {
  toDeci,
  toCenti,
  toUint32,
  toInt16,
  toMilli,
  toPowerFactor,
  registersToString,
  toTimeslot,
} from './model/converters.js';
import { calculatePowerFlows } from './power-flow.js';
import {
  isSanityCheckPassing,
  applyStateOfChargeFallback,
  applyTimeFallback,
  applyFrequencyScaling,
} from './validation.js';
import {
  CHARGE_SLOT_REGISTERS,
  DISCHARGE_SLOT_REGISTERS,
  THREE_PHASE_CHARGE_SLOT_REGISTERS,
  THREE_PHASE_DISCHARGE_SLOT_REGISTERS,
} from './timeslot-registers.js';
import { detectGeneration, type InverterGeneration } from './generation.js';
import { detectModel, DeviceType } from './model/device-types.js';

export interface RegisterCache {
  inputRegisters: Map<number, number>;
  holdingRegisters: Map<number, number>;
}

export interface SnapshotBuilderOptions {
  previousSnapshot?: InverterSnapshot | null;
  /** slaveAddr → IR register cache for each battery */
  batteryRegisterCaches?: Map<number, Map<number, number>>;
  /** slaveAddr → { data: IR cache (fc=4), product: MR cache (fc=22) } for each meter */
  meterRegisterCaches?: Map<number, { data: Map<number, number>; product: Map<number, number> }>;
  isHighVoltage?: boolean;
  /** BCU topology discovered during HV battery scan */
  bcuList?: Array<{ bcuIndex: number; moduleCount: number }>;
}

function getIR(cache: RegisterCache, address: number): number {
  return cache.inputRegisters.get(address) ?? 0;
}

function getHR(cache: RegisterCache, address: number): number {
  return cache.holdingRegisters.get(address) ?? 0;
}

/** Map DeviceType to InverterGeneration for snapshot discriminant. */
function modelToGeneration(model: DeviceType): InverterGeneration {
  switch (model) {
    case DeviceType.HYBRID_GEN3:
    case DeviceType.HYBRID_HV_GEN3:
      return 'gen3';
    case DeviceType.HYBRID_3PH:
    case DeviceType.AC_3PH:
      return 'three_phase';
    default:
      return 'gen2';
  }
}

/**
 * Build an InverterSnapshot from raw Modbus register caches.
 *
 * Returns null if the data fails the sanity check (corrupt register block).
 */
export function buildSnapshot(
  cache: RegisterCache,
  options: SnapshotBuilderOptions = {},
): InverterSnapshot | null {
  const {
    previousSnapshot = null,
    batteryRegisterCaches = new Map(),
    meterRegisterCaches = new Map(),
    bcuList = [],
  } = options;
  const isHv = options.isHighVoltage ?? false;

  // ── Sanity check ──────────────────────────────────────────────────────────
  // Reject obviously corrupt data — all register quirks manifest simultaneously.
  // modbus_version: HR(34) → toCenti; must be <= 2
  // modbus_address: HR(30); must be <= 100
  // user_code: HR(33); must be <= 100
  // temp_inverter_heatsink: IR(41) → toDeci; must be <= 100°C
  const modbusVersion = toCenti(getHR(cache, 34));
  const modbusAddress = getHR(cache, 30);
  const userCode = getHR(cache, 33);
  const heatsinkTemp = toDeci(getIR(cache, 41));

  if (!isSanityCheckPassing({ modbusVersion, modbusAddress, userCode, heatsinkTemp })) {
    return null;
  }

  // ── Identity ──────────────────────────────────────────────────────────────
  // serial_number: HR(13-17), 5 registers, 10-char ASCII string
  const serialRegs = [13, 14, 15, 16, 17].map(a => getHR(cache, a));
  const serialNumber = registersToString(serialRegs);

  // device_type_code: HR(0)
  const modelCode = getHR(cache, 0);

  // Detect generation from device_type_code (HR0) + arm_firmware_version (HR21),
  // falling back to serial prefix detection if registers are missing.
  // GivTCP uses HR(0) and HR(21) — serial prefix alone is unreliable
  // (e.g. "FD" prefix is Gen3 but not in the serial prefix map).
  const armFirmwareVersion = getHR(cache, 21);
  const generation = modelCode !== 0
    ? modelToGeneration(detectModel(modelCode, armFirmwareVersion))
    : detectGeneration(serialNumber);

  // ── Real-time power ───────────────────────────────────────────────────────
  // p_pv1: IR(18), p_pv2: IR(20) — both unsigned watts
  const pvString1Power = getIR(cache, 18);
  const pvString2Power = getIR(cache, 20);
  const solarPower = pvString1Power + pvString2Power;

  // p_battery: IR(52) — signed int16; positive = discharging, negative = charging
  const batteryPower = toInt16(getIR(cache, 52));

  // p_grid_out: IR(30) — signed int16; positive = export, negative = import
  const gridPower = toInt16(getIR(cache, 30));

  // p_load_demand: IR(42)
  const loadPower = getIR(cache, 42);

  // p_inverter_out: IR(24) — signed int16, inverter AC output power
  const inverterOutputPower = toInt16(getIR(cache, 24));

  // p_grid_apparent: IR(43) — unsigned, grid apparent power in VA
  const gridApparentPower = getIR(cache, 43);

  // p_eps_backup: IR(31) — unsigned, EPS backup output power
  const epsBackupPower = getIR(cache, 31);

  // ── PV string measurements ─────────────────────────────────────────────────
  // v_pv1: IR(1), v_pv2: IR(2) — toDeci → V
  const pvString1Voltage = toDeci(getIR(cache, 1));
  const pvString2Voltage = toDeci(getIR(cache, 2));
  // i_pv1: IR(8), i_pv2: IR(9) — toDeci → A
  const pvString1Current = toDeci(getIR(cache, 8));
  const pvString2Current = toDeci(getIR(cache, 9));

  // ── Battery state ─────────────────────────────────────────────────────────
  // battery_percent: IR(59) — SOC with fallback chain
  const reportedSoc = getIR(cache, 59);
  const socForceAdjust = getHR(cache, 29); // soc_force_adjust: HR(29)
  const isCalibrating = socForceAdjust !== 0;
  const previousSoc = previousSnapshot?.stateOfCharge ?? null;
  const stateOfCharge = applyStateOfChargeFallback(reportedSoc, previousSoc, isCalibrating);

  // v_battery: IR(50) — battery voltage, toCenti → V
  const batteryVoltage = toCenti(getIR(cache, 50));

  // i_battery: IR(51) — signed int16, toCenti → A
  const batteryCurrent = toCenti(toInt16(getIR(cache, 51)));

  // ── Grid ──────────────────────────────────────────────────────────────────
  // v_ac1: IR(5) — AC voltage, toDeci → V
  const gridVoltage = toDeci(getIR(cache, 5));

  // f_ac1: IR(13) — AC frequency, firmware scaling then toDeci → Hz
  const rawFrequency = getIR(cache, 13);
  const gridFrequency = toDeci(applyFrequencyScaling(rawFrequency));

  // i_ac1: IR(10) — AC current, toDeci → A
  const inverterCurrent = toDeci(getIR(cache, 10));

  // ── EPS backup ──────────────────────────────────────────────────────────────
  // v_eps_backup: IR(53) — toDeci → V
  const epsBackupVoltage = toDeci(getIR(cache, 53));
  // f_eps_backup: IR(54) — toCenti → Hz
  const epsBackupFrequency = toCenti(getIR(cache, 54));

  // ── Temperatures ────────────────────────────────────────────────────────────
  // temp_charger: IR(55) — toDeci → °C (labeled "BMS Temperature" in cloud CSV)
  const chargerTemperature = toDeci(getIR(cache, 55));
  // temp_battery: IR(56) — toDeci → °C
  const batteryTemperature = toDeci(getIR(cache, 56));

  // ── Energy totals ─────────────────────────────────────────────────────────
  // e_pv_total: IR(11, 12) — uint32, toDeci → kWh
  const pvEnergyTotalKwh = toDeci(toUint32(getIR(cache, 11), getIR(cache, 12)));

  // Battery charge/discharge totals are computed after battery snapshots are built,
  // using the battery module's own registers (IR 105/106) as primary source.
  // Placeholder — filled in below after battery snapshot construction.

  // e_grid_in_total: IR(32, 33) — uint32, toDeci → kWh (import)
  const gridImportEnergyTotalKwh = toDeci(toUint32(getIR(cache, 32), getIR(cache, 33)));

  // e_grid_out_total: IR(21, 22) — uint32, toDeci → kWh (export)
  const gridExportEnergyTotalKwh = toDeci(toUint32(getIR(cache, 21), getIR(cache, 22)));

  // e_battery_throughput_total: IR(6, 7) — uint32, toDeci → kWh
  const batteryThroughputTotalKwh = toDeci(toUint32(getIR(cache, 6), getIR(cache, 7)));

  // work_time_total: IR(47, 48) — uint32 → hours
  const hoursOfOperation = toUint32(getIR(cache, 47), getIR(cache, 48));

  // ── Daily energy ────────────────────────────────────────────────────────
  // All single 16-bit IR registers, toDeci → kWh
  const pvString1EnergyTodayKwh = toDeci(getIR(cache, 17));  // e_pv1_day
  const pvString2EnergyTodayKwh = toDeci(getIR(cache, 19));  // e_pv2_day
  const pvEnergyTodayKwh = pvString1EnergyTodayKwh + pvString2EnergyTodayKwh;
  const batteryChargeEnergyTodayKwh = toDeci(getIR(cache, 36));   // e_battery_charge_today
  const batteryDischargeEnergyTodayKwh = toDeci(getIR(cache, 37)); // e_battery_discharge_today
  const gridImportEnergyTodayKwh = toDeci(getIR(cache, 26));       // e_grid_in_day
  const gridExportEnergyTodayKwh = toDeci(getIR(cache, 25));       // e_grid_out_day

  // ── Consumption (derived) ──────────────────────────────────────────────
  // Formula: (inverter_out - ac_charge) - (export - import)
  // Reference: GivTCP read.py — hybrid inverter consumption calculation
  const round2 = (x: number) => Math.round(x * 100) / 100;

  // e_inverter_out_total: IR(45, 46) — uint32, toDeci → kWh
  const inverterOutputEnergyTotalKwh = toDeci(toUint32(getIR(cache, 45), getIR(cache, 46)));
  // e_inverter_in_total: IR(27, 28) — uint32, toDeci → kWh (AC/grid charge energy)
  const acChargeEnergyTotalKwh = toDeci(toUint32(getIR(cache, 27), getIR(cache, 28)));
  // e_inverter_out_day: IR(44)
  const inverterOutputEnergyTodayKwh = toDeci(getIR(cache, 44));
  // e_inverter_in_day: IR(35)
  const acChargeEnergyTodayKwh = toDeci(getIR(cache, 35));

  const consumptionEnergyTotalKwh = Math.max(0,
    round2((inverterOutputEnergyTotalKwh - acChargeEnergyTotalKwh)
         - (gridExportEnergyTotalKwh - gridImportEnergyTotalKwh)));
  const consumptionEnergyTodayKwh = Math.max(0,
    round2((inverterOutputEnergyTodayKwh - acChargeEnergyTodayKwh)
         - (gridExportEnergyTodayKwh - gridImportEnergyTodayKwh)));

  // ── Charge/discharge timeslots ───────────────────────────────────────────
  // Gen3: 10 charge + 10 discharge slots, each with a per-slot target SOC.
  // Gen2: 1 charge slot (HR 94/95), 2 discharge slots (HR 56/57, HR 44/45).
  // three_phase: 2 charge slots (HR 1113-1116), 2 discharge slots (HR 1118-1121).
  let chargeSlots: TimeSlot[] | TimeSlotConfig[];
  let dischargeSlots: TimeSlot[] | TimeSlotConfig[];

  if (generation === 'gen3') {
    chargeSlots = CHARGE_SLOT_REGISTERS.map(reg => ({
      ...toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end)),
      targetStateOfCharge: getHR(cache, reg.targetStateOfCharge),
    }));
    dischargeSlots = DISCHARGE_SLOT_REGISTERS.map(reg => ({
      ...toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end)),
      targetStateOfCharge: getHR(cache, reg.targetStateOfCharge),
    }));
  } else if (generation === 'three_phase') {
    chargeSlots = THREE_PHASE_CHARGE_SLOT_REGISTERS.map(reg =>
      toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end))
    );
    dischargeSlots = THREE_PHASE_DISCHARGE_SLOT_REGISTERS.map(reg =>
      toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end))
    );
  } else {
    // Gen2: 1 charge slot, 2 discharge slots
    chargeSlots = [toTimeslot(getHR(cache, 94), getHR(cache, 95))];
    dischargeSlots = [
      toTimeslot(getHR(cache, 56), getHR(cache, 57)),
      toTimeslot(getHR(cache, 44), getHR(cache, 45)),
    ];
  }

  // enable_charge: HR(96)
  const enableCharge = getHR(cache, 96) !== 0;

  // enable_discharge: HR(59)
  const enableDischarge = getHR(cache, 59) !== 0;

  // charge_target_soc: HR(116) — legacy single target, applies to slot 1 on Gen2
  const chargeTargetStateOfCharge = getHR(cache, 116);

  // ── System time ───────────────────────────────────────────────────────────
  // system_time: HR(35-40) — year, month, day, hour, minute, second
  // GivEnergy stores the year as a 2-digit offset from 2000 (e.g. 26 = 2026)
  const year = 2000 + getHR(cache, 35);
  const month = getHR(cache, 36);
  const day = getHR(cache, 37);
  const hour = getHR(cache, 38);
  const minute = getHR(cache, 39);
  const second = getHR(cache, 40);
  const reportedTime = new Date(year, month - 1, day, hour, minute, second);
  const previousTime = previousSnapshot?.systemTime ?? null;
  const systemTime = applyTimeFallback(reportedTime, previousTime);

  // ── Power flows ───────────────────────────────────────────────────────────
  // p_battery sign convention: positive = discharging, negative = charging
  // (matches GivTCP: Battery_power >= 0 → discharge_power)
  const dischargeWatts = batteryPower > 0 ? batteryPower : 0;
  const chargeWatts = batteryPower < 0 ? -batteryPower : 0;
  const exportWatts = gridPower > 0 ? gridPower : 0;
  const importWatts = gridPower < 0 ? -gridPower : 0;

  const powerFlows = calculatePowerFlows({
    solarWatts: solarPower,
    loadWatts: loadPower,
    chargeWatts,
    dischargeWatts,
    importWatts,
    exportWatts,
  });

  // ── Batteries ─────────────────────────────────────────────────────────────
  const batteries: BatterySnapshot[] = [];

  if (isHv && bcuList.length > 0) {
    // HV: build BMU snapshots from per-module register caches
    for (const { bcuIndex, moduleCount } of bcuList) {
      const bcuSlave = 0x70 + bcuIndex;
      const bcuCache = batteryRegisterCaches.get(bcuSlave);
      const bcuData = bcuCache ? parseBcuData(bcuCache) : null;

      for (let bmuIndex = 0; bmuIndex < moduleCount; bmuIndex++) {
        const bmuKey = (bcuIndex << 8) | bmuIndex;
        const bmuCache = batteryRegisterCaches.get(bmuKey);
        if (!bmuCache) continue;

        const bmu = buildBmuSnapshot(bmuCache, bcuIndex);
        if (bmu !== null) {
          // Populate pack-level data from BCU onto each BMU snapshot
          if (bcuData) {
            bmu.stateOfCharge = bcuData.stateOfChargeMax;
            bmu.voltage = bcuData.voltage;
            bmu.cycleCount = bcuData.cycleCount;
          }
          batteries.push(bmu);
        }
      }
    }
  } else {
    // LV: existing logic
    for (const [, irCache] of batteryRegisterCaches) {
      const bat = buildBatterySnapshot(irCache);
      if (bat !== null) {
        batteries.push(bat);
      }
    }
  }

  // ── Meters ──────────────────────────────────────────────────────────────
  const meters: MeterSnapshot[] = [];
  for (const [slaveAddr, caches] of meterRegisterCaches) {
    const meter = buildMeterSnapshot(slaveAddr, caches.data, caches.product);
    if (meter !== null) {
      meters.push(meter);
    }
  }

  // Battery charge/discharge totals:
  //   HV: sum energy totals from all BCUs
  //   LV primary: battery module registers IR(106)/IR(105) (summed across all batteries)
  //   Fallback: inverter registers IR(181) charge / HR(180) discharge
  //   Last resort: IR(27,28) e_inverter_in_total / IR(29) e_discharge_year
  let batteryChargeEnergyTotalKwh = 0;
  let batteryDischargeEnergyTotalKwh = 0;

  if (isHv && bcuList.length > 0) {
    // HV: sum energy totals from all BCUs
    for (const { bcuIndex } of bcuList) {
      const bcuSlave = 0x70 + bcuIndex;
      const bcuCache = batteryRegisterCaches.get(bcuSlave);
      if (bcuCache) {
        const bcuData = parseBcuData(bcuCache);
        batteryChargeEnergyTotalKwh += bcuData.chargeEnergyTotalKwh;
        batteryDischargeEnergyTotalKwh += bcuData.dischargeEnergyTotalKwh;
      }
    }
  } else if (batteries.length > 0) {
    batteryChargeEnergyTotalKwh = batteries.reduce((sum, b) => sum + b.chargeEnergyTotalKwh, 0);
    batteryDischargeEnergyTotalKwh = batteries.reduce((sum, b) => sum + b.dischargeEnergyTotalKwh, 0);
  }
  if (batteryChargeEnergyTotalKwh === 0 && batteryDischargeEnergyTotalKwh === 0) {
    const invCharge = toDeci(getIR(cache, 181));
    const invDischarge = toDeci(getHR(cache, 180));
    if (invCharge !== 0 || invDischarge !== 0) {
      batteryChargeEnergyTotalKwh = invCharge;
      batteryDischargeEnergyTotalKwh = invDischarge;
    } else {
      batteryChargeEnergyTotalKwh = toDeci(toUint32(getIR(cache, 27), getIR(cache, 28)));
      batteryDischargeEnergyTotalKwh = toDeci(getIR(cache, 29));
    }
  }

  return {
    generation,
    serialNumber,
    modelCode,
    solarPower,
    pvString1Power,
    pvString2Power,
    batteryPower,
    gridPower,
    loadPower,
    inverterOutputPower,
    gridApparentPower,
    epsBackupPower,
    pvString1Voltage,
    pvString2Voltage,
    pvString1Current,
    pvString2Current,
    stateOfCharge,
    batteryVoltage,
    batteryCurrent,
    gridVoltage,
    gridFrequency,
    inverterCurrent,
    epsBackupVoltage,
    epsBackupFrequency,
    inverterHeatsinkTemp: heatsinkTemp,
    chargerTemperature,
    batteryTemperature,
    pvEnergyTotalKwh,
    batteryChargeEnergyTotalKwh,
    batteryDischargeEnergyTotalKwh,
    gridImportEnergyTotalKwh,
    gridExportEnergyTotalKwh,
    consumptionEnergyTotalKwh,
    batteryThroughputTotalKwh,
    hoursOfOperation,
    pvEnergyTodayKwh,
    pvString1EnergyTodayKwh,
    pvString2EnergyTodayKwh,
    batteryChargeEnergyTodayKwh,
    batteryDischargeEnergyTodayKwh,
    gridImportEnergyTodayKwh,
    gridExportEnergyTodayKwh,
    consumptionEnergyTodayKwh,
    chargeSlots,
    dischargeSlots,
    enableCharge,
    enableDischarge,
    chargeTargetStateOfCharge,
    systemTime,
    powerFlows,
    batteries,
    meters,
  } as InverterSnapshot;
}

/**
 * Build a BatterySnapshot from a single battery's input register cache.
 *
 * Returns null if the serial number registers are all zero (no battery at this address).
 * GivTCP uses this to count how many LV batteries are present (scan 0x32-0x37).
 */
export function buildBatterySnapshot(
  irCache: Map<number, number>,
): BatterySnapshot | null {
  function get(address: number): number {
    return irCache.get(address) ?? 0;
  }

  // serial_number: IR(110-114) — 5 registers, 10-char ASCII
  // If all registers are zero, no battery is present at this address.
  const serialRegs = [110, 111, 112, 113, 114].map(a => get(a));
  const isAllNull = serialRegs.every(r => r === 0);
  if (isAllNull) {
    return null;
  }
  const serialNumber = registersToString(serialRegs);

  // soc: IR(100)
  const stateOfCharge = get(100);

  // v_cells_sum: IR(80) — sum of all cell voltages, toMilli → V
  const voltage = toMilli(get(80));

  // e_battery_discharge_total: IR(105) — toDeci → kWh
  const dischargeEnergyTotalKwh = toDeci(get(105));
  // e_battery_charge_total: IR(106) — toDeci → kWh
  const chargeEnergyTotalKwh = toDeci(get(106));

  // t_max: IR(103), t_min: IR(104) — toDeci → °C
  const temperatureMax = toDeci(get(103));
  const temperatureMin = toDeci(get(104));

  // num_cycles: IR(96)
  const cycleCount = get(96);

  // Cell voltages: IR(60-75) — 16 values, toMilli → V
  const cellVoltages: number[] = [];
  for (let i = 0; i < 16; i++) {
    cellVoltages.push(toMilli(get(60 + i)));
  }

  return {
    serialNumber,
    stateOfCharge,
    voltage,
    dischargeEnergyTotalKwh,
    chargeEnergyTotalKwh,
    temperatureMax,
    temperatureMin,
    cycleCount,
    cellVoltages,
  };
}

/**
 * Build a BatterySnapshot from a single BMU (Battery Module Unit) register cache.
 *
 * BMU modules in HV systems report per-cell data (24 cells) but not pack-level
 * aggregates (SOC, voltage, energy totals) — those come from the BCU.
 *
 * Register layout differences from LV batteries:
 *  - 24 cell voltages at IR(60-83) instead of 16 at IR(60-75)
 *  - 24 cell temperatures at IR(90-113) — LV batteries don't have per-cell temps
 *  - Serial at IR(114-118) instead of IR(110-114)
 *
 * Returns null if serial registers are all zero (no module at this address).
 */
export function buildBmuSnapshot(
  irCache: Map<number, number>,
  bcuIndex: number,
): BatterySnapshot | null {
  function get(address: number): number {
    return irCache.get(address) ?? 0;
  }

  // serial_number: IR(114-118) — 5 registers, 10-char ASCII
  const serialRegs = [114, 115, 116, 117, 118].map(a => get(a));
  const isAllNull = serialRegs.every(r => r === 0);
  if (isAllNull) {
    return null;
  }
  const serialNumber = registersToString(serialRegs);

  // 24 cell voltages: IR(60-83) via toMilli → V
  const cellVoltages: number[] = [];
  for (let i = 0; i < 24; i++) {
    cellVoltages.push(toMilli(get(60 + i)));
  }

  // 24 cell temperatures: IR(90-113) via toDeci → °C
  const cellTemps: number[] = [];
  for (let i = 0; i < 24; i++) {
    cellTemps.push(toDeci(get(90 + i)));
  }
  const temperatureMax = Math.max(...cellTemps);
  const temperatureMin = Math.min(...cellTemps);

  return {
    serialNumber,
    stateOfCharge: 0,
    voltage: 0,
    dischargeEnergyTotalKwh: 0,
    chargeEnergyTotalKwh: 0,
    temperatureMax,
    temperatureMin,
    cycleCount: 0,
    cellVoltages,
    stack: bcuIndex,
  };
}

/** Parsed BCU (Battery Control Unit) pack-level data */
export interface BcuData {
  numberOfModules: number;
  voltage: number;
  current: number;
  power: number;
  stateOfChargeMax: number;
  stateOfChargeMin: number;
  stateOfHealth: number;
  chargeEnergyTotalKwh: number;
  dischargeEnergyTotalKwh: number;
  cycleCount: number;
}

/**
 * Parse BCU (Battery Control Unit) register data into structured form.
 *
 * BCU provides pack-level aggregate data for an HV battery stack.
 * Individual module data comes from BMU reads.
 */
export function parseBcuData(irCache: Map<number, number>): BcuData {
  function get(address: number): number {
    return irCache.get(address) ?? 0;
  }

  const socRegister = get(80);

  return {
    numberOfModules: get(64),
    voltage: toDeci(get(73)),
    current: toDeci(toInt16(get(76))),
    power: toMilli(get(79)),
    stateOfChargeMax: (socRegister >> 8) & 0xff,
    stateOfChargeMin: socRegister & 0xff,
    stateOfHealth: get(81),
    chargeEnergyTotalKwh: toDeci(toUint32(get(82), get(83))),
    dischargeEnergyTotalKwh: toDeci(toUint32(get(84), get(85))),
    cycleCount: toDeci(get(100)),
  };
}

/**
 * Build a MeterSnapshot from a CT meter's data and product register caches.
 *
 * Returns null if v_phase_1 is 0 (no meter present at this address).
 * Meter slaves are 0x01–0x08; unlike batteries they can be non-contiguous.
 *
 * Scaling verified against GivEnergy cloud CSV export.
 */
export function buildMeterSnapshot(
  slaveAddress: number,
  dataCache: Map<number, number>,
  productCache: Map<number, number>,
): MeterSnapshot | null {
  function getData(address: number): number {
    return dataCache.get(address) ?? 0;
  }
  function getProduct(address: number): number {
    return productCache.get(address) ?? 0;
  }

  // v_phase_1 at IR(60) — if 0, no meter present
  if (getData(60) === 0) {
    return null;
  }

  // Product info from fc=22 registers
  const serialNumber = toUint32(getProduct(60), getProduct(61));
  const factoryCodeRegs = [getProduct(62), getProduct(63)];
  const factoryCode = registersToString(factoryCodeRegs);
  const meterType = getProduct(64);
  const hardwareVersion = getProduct(65);
  const softwareVersion = getProduct(66);

  // Voltage — toDeci → V
  const voltage: [number, number, number] = [
    toDeci(getData(60)),
    toDeci(getData(61)),
    toDeci(getData(62)),
  ];

  // Current — toCenti → A
  const current: [number, number, number] = [
    toCenti(getData(63)),
    toCenti(getData(64)),
    toCenti(getData(65)),
  ];

  // Active power — int16 → W (signed: negative = import)
  const activePower: [number, number, number] = [
    toInt16(getData(68)),
    toInt16(getData(69)),
    toInt16(getData(70)),
  ];
  let activePowerTotal = toInt16(getData(71));

  // Reactive power — int16 → VAR
  const reactivePower: [number, number, number] = [
    toInt16(getData(72)),
    toInt16(getData(73)),
    toInt16(getData(74)),
  ];
  let reactivePowerTotal = toInt16(getData(75));

  // Apparent power — int16 → VA
  const apparentPower: [number, number, number] = [
    toInt16(getData(76)),
    toInt16(getData(77)),
    toInt16(getData(78)),
  ];
  let apparentPowerTotal = toInt16(getData(79));

  // Power factor — int16 ÷ 10000 → -1.0..1.0
  // Note: GivTCP uses toMilli (÷1000), but ÷10000 matches the GivEnergy cloud CSV export
  const powerFactor: [number, number, number] = [
    toPowerFactor(getData(80)),
    toPowerFactor(getData(81)),
    toPowerFactor(getData(82)),
  ];
  let powerFactorTotal = toPowerFactor(getData(83));

  // Frequency — toCenti → Hz
  const frequency = toCenti(getData(84));

  // Single-phase meter fallback: "total" registers are 0 for single-phase meters,
  // so use phase 1 values when totals are empty but phase 1 has data.
  const isSinglePhase = voltage[1] === 0 && voltage[2] === 0;
  if (isSinglePhase) {
    if (activePowerTotal === 0 && activePower[0] !== 0) activePowerTotal = activePower[0];
    if (reactivePowerTotal === 0 && reactivePower[0] !== 0) reactivePowerTotal = reactivePower[0];
    if (apparentPowerTotal === 0 && apparentPower[0] !== 0) apparentPowerTotal = apparentPower[0];
    if (powerFactorTotal === 0 && powerFactor[0] !== 0) powerFactorTotal = powerFactor[0];
  }

  // Energy — toDeci → kWh (single 16-bit registers, overflow at 6553.5 kWh)
  const importActiveEnergyKwh = toDeci(getData(85));
  const importReactiveEnergy = toDeci(getData(86));
  const exportActiveEnergyKwh = toDeci(getData(87));
  const exportReactiveEnergy = toDeci(getData(88));

  return {
    slaveAddress,
    serialNumber,
    factoryCode,
    meterType,
    hardwareVersion,
    softwareVersion,
    voltage,
    current,
    activePower,
    activePowerTotal,
    reactivePower,
    reactivePowerTotal,
    apparentPower,
    apparentPowerTotal,
    powerFactor,
    powerFactorTotal,
    frequency,
    importActiveEnergyKwh,
    importReactiveEnergy,
    exportActiveEnergyKwh,
    exportReactiveEnergy,
  };
}
