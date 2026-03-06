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
import type { TimeSlotConfig } from './model/register-types.js';
import {
  toDeci,
  toCenti,
  toUint32,
  toInt16,
  toMilli,
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
import { CHARGE_SLOT_REGISTERS, DISCHARGE_SLOT_REGISTERS } from './timeslot-registers.js';

export interface RegisterCache {
  inputRegisters: Map<number, number>;
  holdingRegisters: Map<number, number>;
}

export interface SnapshotBuilderOptions {
  previousSnapshot?: InverterSnapshot | null;
  /** slaveAddr → IR register cache for each battery */
  batteryRegisterCaches?: Map<number, Map<number, number>>;
  isHighVoltage?: boolean;
}

function getIR(cache: RegisterCache, address: number): number {
  return cache.inputRegisters.get(address) ?? 0;
}

function getHR(cache: RegisterCache, address: number): number {
  return cache.holdingRegisters.get(address) ?? 0;
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
  const { previousSnapshot = null, batteryRegisterCaches = new Map() } = options;

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

  // ── Real-time power ───────────────────────────────────────────────────────
  // p_pv1: IR(18), p_pv2: IR(20) — both unsigned watts
  const solarPower = getIR(cache, 18) + getIR(cache, 20);

  // p_battery: IR(52) — signed int16; positive = charging, negative = discharging
  const batteryPower = toInt16(getIR(cache, 52));

  // p_grid_out: IR(30) — signed int16; positive = export, negative = import
  const gridPower = toInt16(getIR(cache, 30));

  // p_load_demand: IR(42)
  const loadPower = getIR(cache, 42);

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

  // ── Charge/discharge timeslots ───────────────────────────────────────────
  // Gen3 inverters support up to 10 charge and 10 discharge timeslots,
  // each with a per-slot target state of charge. Gen2 inverters only
  // populate slots 1-2; the remaining slots read as 00:00-00:00 / SOC 0.
  const chargeSlots: TimeSlotConfig[] = CHARGE_SLOT_REGISTERS.map(reg => ({
    ...toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end)),
    targetStateOfCharge: getHR(cache, reg.targetStateOfCharge),
  }));

  const dischargeSlots: TimeSlotConfig[] = DISCHARGE_SLOT_REGISTERS.map(reg => ({
    ...toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end)),
    targetStateOfCharge: getHR(cache, reg.targetStateOfCharge),
  }));

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
  const chargeWatts = batteryPower > 0 ? batteryPower : 0;
  const dischargeWatts = batteryPower < 0 ? -batteryPower : 0;
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
  for (const [, irCache] of batteryRegisterCaches) {
    const bat = buildBatterySnapshot(irCache);
    if (bat !== null) {
      batteries.push(bat);
    }
  }

  // Battery charge/discharge totals:
  //   Primary: battery module registers IR(106)/IR(105) (summed across all batteries)
  //   Fallback: inverter registers IR(181) charge / HR(180) discharge
  //   Last resort: IR(27,28) e_inverter_in_total / IR(29) e_discharge_year
  let batteryChargeEnergyTotalKwh = 0;
  let batteryDischargeEnergyTotalKwh = 0;
  if (batteries.length > 0) {
    // Sum across all battery modules (GivTCP does this per-battery)
    batteryChargeEnergyTotalKwh = batteries.reduce((sum, b) => sum + b.chargeEnergyTotalKwh, 0);
    batteryDischargeEnergyTotalKwh = batteries.reduce((sum, b) => sum + b.dischargeEnergyTotalKwh, 0);
  }
  if (batteryChargeEnergyTotalKwh === 0 && batteryDischargeEnergyTotalKwh === 0) {
    // No battery data — fall back to inverter registers
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
    serialNumber,
    modelCode,
    solarPower,
    batteryPower,
    gridPower,
    loadPower,
    stateOfCharge,
    batteryVoltage,
    batteryCurrent,
    gridVoltage,
    gridFrequency,
    inverterHeatsinkTemp: heatsinkTemp,
    pvEnergyTotalKwh,
    batteryChargeEnergyTotalKwh,
    batteryDischargeEnergyTotalKwh,
    gridImportEnergyTotalKwh,
    gridExportEnergyTotalKwh,
    chargeSlots,
    dischargeSlots,
    enableCharge,
    enableDischarge,
    chargeTargetStateOfCharge,
    systemTime,
    powerFlows,
    batteries,
  };
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

  // Battery current — not directly available in battery registers; default 0
  const current = 0;

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
    current,
    dischargeEnergyTotalKwh,
    chargeEnergyTotalKwh,
    temperatureMax,
    temperatureMin,
    cycleCount,
    cellVoltages,
  };
}
