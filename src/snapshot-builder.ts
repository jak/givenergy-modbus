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
  applyEnergyRegisterFallback,
} from './validation.js';

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

  // v_battery: IR(50) — battery voltage, toDeci → V
  const batteryVoltage = toDeci(getIR(cache, 50));

  // i_battery: IR(51) — signed int16 → A
  const batteryCurrent = toInt16(getIR(cache, 51));

  // ── Grid ──────────────────────────────────────────────────────────────────
  // v_ac1: IR(5) — AC voltage, toDeci → V
  const gridVoltage = toDeci(getIR(cache, 5));

  // f_ac1: IR(13) — AC frequency, firmware scaling then toDeci → Hz
  const rawFrequency = getIR(cache, 13);
  const gridFrequency = toDeci(applyFrequencyScaling(rawFrequency));

  // ── Energy totals ─────────────────────────────────────────────────────────
  // e_pv_total: IR(11, 12) — uint32, toDeci → kWh
  const pvEnergyTotalKwh = toDeci(toUint32(getIR(cache, 11), getIR(cache, 12)));

  // Battery charge total — primary: e_inverter_in_total IR(27, 28), toDeci
  // Battery discharge total — primary: e_discharge_year IR(29) (single-reg placeholder)
  // Secondary registers: e_battery_charge_total_2 IR(181), e_battery_discharge_total_2 IR(180)
  const primaryCharge = toDeci(toUint32(getIR(cache, 27), getIR(cache, 28)));
  const primaryDischarge = toDeci(getIR(cache, 29));
  const secondaryCharge = toDeci(getIR(cache, 181));
  const secondaryDischarge = toDeci(getIR(cache, 180));
  const { charge: batteryChargeEnergyTotalKwh, discharge: batteryDischargeEnergyTotalKwh } =
    applyEnergyRegisterFallback(primaryCharge, primaryDischarge, secondaryCharge, secondaryDischarge);

  // e_grid_in_total: IR(32, 33) — uint32, toDeci → kWh (import)
  const gridImportEnergyTotalKwh = toDeci(toUint32(getIR(cache, 32), getIR(cache, 33)));

  // e_grid_out_total: IR(21, 22) — uint32, toDeci → kWh (export)
  const gridExportEnergyTotalKwh = toDeci(toUint32(getIR(cache, 21), getIR(cache, 22)));

  // ── Charge configuration ──────────────────────────────────────────────────
  // charge_slot_1: HR(94) start, HR(95) end
  const chargeSlot1 = toTimeslot(getHR(cache, 94), getHR(cache, 95));

  // discharge_slot_1: HR(56) start, HR(57) end
  const dischargeSlot1 = toTimeslot(getHR(cache, 56), getHR(cache, 57));

  // enable_charge: HR(96)
  const enableCharge = getHR(cache, 96) !== 0;

  // enable_discharge: HR(59)
  const enableDischarge = getHR(cache, 59) !== 0;

  // charge_target_soc: HR(116)
  const chargeTargetStateOfCharge = getHR(cache, 116);

  // ── System time ───────────────────────────────────────────────────────────
  // system_time: HR(35-40) — year, month, day, hour, minute, second
  const year = getHR(cache, 35);
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
    chargeSlot1,
    dischargeSlot1,
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

  // cap_remaining: IR(88, 89) — uint32, toCenti → Ah (used as voltage proxy per task spec)
  const voltage = toCenti(toUint32(get(88), get(89)));

  // Battery current — not directly available in battery registers; default 0
  const current = 0;

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
    temperatureMax,
    temperatureMin,
    cycleCount,
    cellVoltages,
  };
}
