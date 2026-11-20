/**
 * v3 inverter snapshot: the decoded state of an inverter, grouped by subsystem.
 *
 * `InverterSnapshot` is discriminated on `layout`. Narrowing on it gives the layout's
 * `settings`, `schedules` and per-phase groups; `model` and `capabilities` then say what
 * a particular unit supports at runtime.
 *
 * Every field's JSDoc gives its unit, source register and scaling. "HR" is a holding
 * register, "IR" an input register, "÷10" means the raw value divided by 10, and
 * "uint32" means two consecutive registers read as `high × 65536 + low`. A register a
 * model or firmware doesn't implement is absent (an optional field), never zero-filled.
 *
 * Sources: docs/plans/2026-11-19-v3-research.md (sections A–C) and website/register-map.md.
 */
import type { SinglePhaseSettings, ThreePhaseSettings } from '../catalogue/index.js';
import type { PowerFlows } from '../power-flow.js';
import type { Capabilities } from './capabilities.js';
import type { InverterModel, SinglePhaseModel, ThreePhaseModel } from './models.js';

// ── Shared value types ───────────────────────────────────────────────────────

/**
 * One value per phase, in phase order: L1, L2, L3.
 *
 * A tuple rather than `{ l1, l2, l3 }`: it matches the meter's per-phase values, it can be
 * iterated and mapped without listing the keys, and the index is the phase number minus one.
 */
export type ThreePhase<T> = readonly [T, T, T];

/** A charge or discharge slot. Times are `"HH:MM"`, stored on the inverter as HHMM decimal. */
export interface TimeSlotConfig {
  /** Slot start, `"HH:MM"`. */
  start: string;
  /** Slot end, `"HH:MM"`. */
  end: string;
  /**
   * Target state of charge for the slot, %. Present only when `capabilities.perSlotTargets`.
   * Charge slots stop at this upper limit; discharge slots stop at this lower limit.
   * On 10-slot firmware charging stops at min(HR 116, slot target) (GivTCP #576).
   */
  targetStateOfCharge?: number;
}

/** Inverter operating status (single-phase IR 0, three-phase IR 1076 and IR 1124). */
export type InverterStatus = 'waiting' | 'normal' | 'warning' | 'fault' | 'updating' | 'unknown';

// ── Identity ─────────────────────────────────────────────────────────────────

/** Firmware versions reported by the inverter. */
export interface Firmware {
  /**
   * DSP firmware version. Single-phase HR 19. Three-phase IR 1325 (AC-side DSP), because
   * HR 19 is not used there.
   */
  dsp: number;
  /**
   * ARM firmware version. Single-phase HR 21. Three-phase IR 1327, because HR 21 reads 0
   * there. Model detection and capabilities depend on it.
   */
  arm: number;
  /** Battery management system firmware of the first battery, HR 18 (e.g. 4009). */
  batteryManagementSystem: number;
  /** Modbus protocol version, HR 34 ÷100 (raw 140 is version 1.40). */
  modbusVersion: number;
}

/** Three-phase firmware adds the DC-side DSP. */
export interface ThreePhaseFirmware extends Firmware {
  /** DC-side DSP firmware version, IR 1326. */
  dcDsp: number;
}

/** Grid code certification, from the first two hex digits of HR 2. */
export type Certification =
  | 'g98'
  | 'g99'
  | 'g98_northern_ireland'
  | 'g99_northern_ireland'
  | 'unknown';

/** Static facts about the inverter: what it is and how it is configured. */
export interface Identity<M extends InverterModel = InverterModel> {
  /** Inverter serial number, HR 13–17: 10 ASCII characters, two per register. */
  serialNumber: string;
  /**
   * First battery's serial number as the inverter reports it, HR 8–12 (10 ASCII characters).
   * Absent when the registers are empty.
   */
  batterySerialNumber?: string;
  /**
   * Device type code, HR 0. Read as four hex digits: the first one or two identify the model
   * family (research A), e.g. `0x2001` is a 5 kW hybrid.
   */
  deviceTypeCode: number;
  /** Model resolved from HR 0 and the ARM firmware version (research A). */
  model: M;
  firmware: Firmware;
  /** Installed battery chemistry. HR 54: 0 lead acid, 1 lithium (three-phase IR 1121). */
  batteryType: 'lithium' | 'lead_acid';
  /** Nominal battery capacity, Ah. HR 55 (e.g. 186 on a 9.5 kWh Gen3 battery). */
  batteryCapacityAh: number;
  /** Grid meter type. HR 47: 0 CT clamp or EM418 meter, 1 EM115 meter. */
  meterType: 'ct_or_em418' | 'em115';
  /** Rated AC power, W, looked up from the device type code (HR 0). Absent for unknown codes. */
  ratedPower?: number;
  /**
   * Maximum battery charge/discharge power, W (research A). For the `20xx` family it is
   * 3600 W when the ARM firmware century is 3, 8 or 9, else 2600 W; others come from a
   * per-code table. Absent for unknown codes.
   */
  batteryMaxPower?: number;
  /** Number of solar inputs (MPPT trackers), HR 3 high byte. Absent when it reads 0. */
  solarInputCount?: number;
  /** USB device inserted in the inverter. HR 22: 0 none, 1 Wi-Fi dongle, 8 disk. */
  usbDevice: 'none' | 'wifi' | 'disk' | 'unknown';
  /** CT ammeter enabled, HR 7. */
  ammeterEnabled: boolean;
  /** Grid code certification, HR 2 first two hex digits: 8 G98, 12 G99, 16 G98 NI, 17 G99 NI. */
  certification?: Certification;
  /** Modbus device address the inverter answers on, HR 30. Over 100 marks a bad read. */
  modbusAddress: number;
  /** User code, HR 33. Over 100 marks a bad read (research D). */
  userCode: number;
}

export interface ThreePhaseIdentity extends Identity<ThreePhaseModel> {
  firmware: ThreePhaseFirmware;
}

// ── Status ───────────────────────────────────────────────────────────────────

export interface Status {
  /** Operating status. Single-phase IR 0, three-phase IR 1076: 0 waiting, 1 normal, 2 warning, 3 fault, 4 updating firmware. */
  inverterStatus: InverterStatus;
  /**
   * Active inverter fault messages, decoded LSB-first. Single-phase: the 32-bit fault word
   * HR 223/224 (named bits from the old GivTCP table; bit 11 is "Hall Sensor"). Three-phase:
   * the eight fault words IR 1300–1307. Empty when there are no faults.
   */
  faults: string[];
  /** Inverter clock, HR 35–40 (year is 2000 + HR 35, then month, day, hour, minute, second). */
  systemTime: Date;
}

export interface SinglePhaseStatus extends Status {
  /** Charge status, IR 14: 0 idle, 2 charging, 3 finishing, 5 discharging. Absent when unread. */
  chargeStatus?: 'idle' | 'charging' | 'finishing' | 'discharging' | 'unknown';
  /** System mode, IR 49, raw. Its values are not documented for single-phase. */
  systemMode: number;
  /** Inverter fault word, IR 39, as 4 lowercase hex digits (e.g. `'0000'`). Bit meanings unconfirmed. */
  faultCode: string;
  /** Inverter warning word, IR 40, as 4 lowercase hex digits. Bit meanings unconfirmed. */
  warningCode: string;
  /**
   * Active battery warnings from IR 57, decoded LSB-first: 0 under-temperature charge,
   * 1 under-temperature discharge, 2 over-temperature charge, 3 over-temperature discharge,
   * 4 under-voltage, 5 over-voltage, 6 short circuit, 7 over-current, 8 module temperature,
   * 9 battery temperature, 10 BMS communication, 12 soft start, 13 voltage low, 14 voltage
   * high, 15 meter communication. Not IR 56, which old GivTCP read by mistake.
   */
  batteryWarnings: string[];
  /**
   * Total hours of operation, IR 47–48 uint32. Absent when the value is over 100 years
   * (876,000 h), which marks a bad read: the HV Gen3 capture reads IR 47 = 11034, IR 48 = 0.
   */
  hoursOfOperation?: number;
  /** Inverter start-up countdown, s, IR 38. */
  countdownSeconds: number;
}

export interface ThreePhaseStatus extends Status {
  /** System mode, IR 1075: 0 offline, 1 grid tied. */
  systemMode: 'offline' | 'grid_tied';
  /** DC-side status, IR 1124, with the same values as `inverterStatus`. */
  dcStatus: InverterStatus;
  /** Start delay time, IR 1077, raw (unit undocumented). */
  startDelayTime: number;
}

// ── Solar ────────────────────────────────────────────────────────────────────

/** One PV string (DC input). */
export interface SolarString {
  /** String voltage, V. Single-phase IR 1 / IR 2 ÷10; three-phase IR 1001 / IR 1002 ÷10. */
  voltage: number;
  /** String current, A. Single-phase IR 8 / IR 9 ÷10; three-phase IR 1009 / IR 1010 ÷10. */
  current: number;
  /** String power, W. Single-phase IR 18 / IR 20; three-phase IR 1017–1018 / IR 1019–1020 uint32 ÷10. */
  power: number;
  /** Energy generated today, kWh. Single-phase IR 17 / IR 19 ÷10; three-phase IR 1366–1367 / IR 1370–1371 uint32 ÷10. */
  energyTodayKwh: number;
}

export interface ThreePhaseSolarString extends SolarString {
  /** Lifetime energy generated, kWh. IR 1368–1369 / IR 1372–1373 uint32 ÷10. */
  energyTotalKwh: number;
}

export interface Solar<S extends SolarString = SolarString> {
  /**
   * Total solar power, W. Single-phase IR 18 + IR 20; three-phase the sum of the strings. On
   * AC-coupled and All in One models these registers still count generation, metered on the
   * AC side, even though `strings` is empty.
   */
  power: number;
  /**
   * The PV strings, string 1 first. Empty on AC-coupled models (`ac`, `ac_3ph`) and the
   * All in One (`all_in_one`): they have no DC string, and their PV voltage and current
   * registers echo the AC side (research C; the external library's `pv_string_vi_ac_derived`).
   */
  strings: S[];
  /** Solar energy generated today, kWh. Single-phase: IR 17 + IR 19 ÷10. Three-phase: IR 1412–1413 uint32 ÷10. */
  energyTodayKwh: number;
  /** Lifetime solar energy generated, kWh. Single-phase IR 11–12 uint32 ÷10; three-phase IR 1374–1375 uint32 ÷10. */
  energyTotalKwh: number;
}

export interface SinglePhaseSolar extends Solar {
  /** Combined generation power, W, IR 247–248 uint32. Gen3 and later only; absent otherwise. */
  combinedGenerationPower?: number;
  /** Solar diverter energy, kWh, IR 23 ÷10. */
  diverterEnergyKwh: number;
}

// ── Battery ──────────────────────────────────────────────────────────────────

/** Battery energy counters. */
export interface BatteryEnergy {
  /**
   * Energy charged today, kWh. Single-phase IR 36 ÷10 (Gen1 falls back to IR 183 ÷10);
   * three-phase IR 1392–1393 uint32 ÷10.
   */
  chargeTodayKwh: number;
  /**
   * Energy discharged today, kWh. Single-phase IR 37 ÷10 (Gen1 falls back to IR 182 ÷10);
   * three-phase IR 1388–1389 uint32 ÷10.
   */
  dischargeTodayKwh: number;
  /**
   * Lifetime energy charged, kWh. Single-phase, first non-zero of: HV battery stacks summed
   * (uint32 ÷10); the LV battery module's IR 106 ÷10 (a stack-level value, identical on every
   * pack, so not summed; wraps at 6553.5); inverter IR 181 ÷10; IR 27–28. HR 4109–4112 are
   * write-only seed registers and are not used. Three-phase IR 1394–1395 uint32 ÷10.
   */
  chargeTotalKwh: number;
  /**
   * Lifetime energy discharged, kWh. Same fallback chain as `chargeTotalKwh`, using IR 105,
   * then HR 180 ÷10, then IR 29. Three-phase IR 1390–1391 uint32 ÷10.
   */
  dischargeTotalKwh: number;
  /** Lifetime battery throughput, kWh. Single-phase IR 6–7 uint32 ÷10. Absent on three-phase. */
  throughputTotalKwh?: number;
}

export interface Battery {
  /**
   * Battery power at the inverter, W. Positive is discharging, negative is charging.
   * Single-phase IR 52 signed. Three-phase: discharge IR 1136–1137 minus charge IR 1138–1139,
   * each uint32 ÷10.
   */
  power: number;
  /**
   * Battery voltage measured by the inverter, V. Single-phase IR 50 ÷100. Three-phase
   * IR 1133 ÷10 (the inverter side; the BMS reading is `batteryManagementSystemVoltage`).
   */
  voltage: number;
  /**
   * Battery current, A. Positive is discharging. Single-phase IR 51 signed ÷100;
   * three-phase IR 1140 signed ÷100.
   */
  current: number;
  /** State of charge, %. Single-phase IR 59; three-phase IR 1132. */
  stateOfCharge: number;
  energy: BatteryEnergy;
  /** Low-voltage battery modules (one per BMS at 0x32–0x37), or high-voltage modules (BMUs). */
  modules: BatteryModule[];
  /** High-voltage battery stacks (one per battery control unit). Present when `capabilities.highVoltageBattery`. */
  stacks?: BatteryStack[];
}

export interface SinglePhaseBattery extends Battery {
  /** Battery temperature from the inverter's sensor, °C. IR 56 signed ÷10. */
  temperature: number;
  /** Battery charger temperature, °C. IR 55 signed ÷10. The GivEnergy cloud CSV calls it "BMS Temperature". */
  chargerTemperature: number;
}

export interface ThreePhaseBattery extends Battery {
  /** What the inverter serves first from the battery, IR 1120: 0 load, 1 battery, 2 grid. */
  priority: 'load' | 'battery' | 'grid';
  /** Battery voltage reported by the BMS, V. IR 1131 ÷10. */
  batteryManagementSystemVoltage: number;
}

// ── Battery modules and stacks ───────────────────────────────────────────────

/**
 * A low-voltage battery module, read from its own BMS at device address 0x32–0x37,
 * input registers 60–115.
 */
export interface LowVoltageBatteryModule {
  kind: 'low_voltage';
  /** Battery serial number, IR 110–114 (10 ASCII characters). */
  serialNumber: string;
  /** BMS firmware version, IR 98. */
  firmwareVersion: number;
  /** State of charge from the module's BMS, %. IR 100. May differ slightly from the inverter's IR 59. */
  stateOfCharge: number;
  /** Sum of the cell voltages, V. IR 80 ÷1000. */
  voltage: number;
  /** Module output voltage, V. IR 82–83 uint32 ÷1000. */
  outputVoltage: number;
  /**
   * Average pack current, A. Positive is discharging. IR 95 signed ÷100. Present only on
   * Gen3/AC ARM ≥ 214 with BMS firmware 3020–3999 or ≥ 4009; other firmware reports noise.
   */
  current?: number;
  /** Charge/discharge cycles, IR 96. */
  cycleCount: number;
  /** Number of cells, IR 97. */
  cellCount: number;
  /** Cell voltages, V, cell 1 first. IR 60–75 ÷1000 (16 cells). */
  cellVoltages: number[];
  /**
   * Cell group temperatures, °C, signed ÷10: IR 76 cells 1–4, IR 77 cells 5–8, IR 78 cells
   * 9–12, IR 79 cells 13–16.
   */
  cellTemperatures: number[];
  /** Highest cell temperature, °C. IR 103 signed ÷10. */
  temperatureMax: number;
  /** Lowest cell temperature, °C. IR 104 signed ÷10. */
  temperatureMin: number;
  /** BMS MOSFET temperature, °C. IR 81 signed ÷10. */
  mosfetTemperature: number;
  /** Charge MOSFET on: IR 91 high byte, bit 1. */
  chargeMosfetOn: boolean;
  /** Discharge MOSFET on: IR 91 high byte, bit 2. */
  dischargeMosfetOn: boolean;
  /** Calibrated capacity, Ah. IR 84–85 uint32 ÷100. */
  calibratedCapacityAh: number;
  /** Design capacity, Ah. IR 86–87 uint32 ÷100. */
  designCapacityAh: number;
  /** Remaining capacity, Ah. IR 88–89 uint32 ÷100. */
  remainingCapacityAh: number;
  /** Second design capacity field, Ah. IR 101–102 uint32 ÷100. Meaning beyond the name is unknown. */
  designCapacity2Ah: number;
  /** BMS status bytes, raw: IR 90 low, IR 90 high, IR 91 low, IR 91 high, IR 92 low, IR 92 high, IR 93 low. */
  statusBytes: number[];
  /** BMS warning bytes, raw: IR 94 low, IR 94 high. */
  warningBytes: number[];
  /** Force-discharge flag, IR 107, raw. Only 0 has been seen. */
  forceDischargeFlag: number;
  /**
   * Lifetime energy discharged by the stack, kWh. IR 105 ÷10, wraps at 6553.5. Stack-level:
   * every pack reports the same value, so don't sum it across modules.
   */
  dischargeTotalKwh: number;
  /** Lifetime energy charged by the stack, kWh. IR 106 ÷10; same caveats as `dischargeTotalKwh`. */
  chargeTotalKwh: number;
}

/**
 * A high-voltage battery module (BMU). Module k of stack n is at device address 0x50 + k,
 * with registers offset by 120 × n from the IR 60 base.
 */
export interface HighVoltageBatteryModule {
  kind: 'high_voltage';
  /** Index of the stack (battery control unit) the module belongs to, from 0. */
  stack: number;
  /** Index of the module within its stack, from 0. */
  index: number;
  /** Module serial number, IR 114–118 (10 ASCII characters). */
  serialNumber: string;
  /** Cell voltages, V, cell 1 first. IR 60–83 ÷1000 (24 cells). */
  cellVoltages: number[];
  /** Cell temperatures, °C, cell 1 first. IR 90–113 signed ÷10 (24 cells). */
  cellTemperatures: number[];
  /** Highest of `cellTemperatures`, °C. */
  temperatureMax: number;
  /** Lowest of `cellTemperatures`, °C. */
  temperatureMin: number;
}

export type BatteryModule = LowVoltageBatteryModule | HighVoltageBatteryModule;

/** Battery control unit status, BCU IR 70. */
export type BatteryStackStatus =
  | 'initialising'
  | 'precharge'
  | 'standby'
  | 'charging'
  | 'discharging'
  | 'error'
  | 'updating'
  | 'off'
  | 'production'
  | 'unknown';

/** A high-voltage battery stack, read from its battery control unit at device address 0x70 + n. */
export interface BatteryStack {
  /** Stack index, from 0. */
  index: number;
  /** Status, IR 70: 0 initialising, 1 precharge, 2 standby, 3 charging, 4 discharging, 5 error, 6 updating, 7 off, 8 production. */
  status: BatteryStackStatus;
  /** Number of modules, IR 64. */
  moduleCount: number;
  /** Cells per module, IR 65. */
  cellsPerModule: number;
  /** Cell voltage sensor count, IR 67 (a count, not a voltage). */
  cellVoltageCount: number;
  /** Cell temperature sensor count, IR 68 (a count, not a temperature). */
  cellTemperatureCount: number;
  /** Stack voltage, V. IR 73 ÷10. */
  voltage: number;
  /** Load-side voltage, V. IR 74 ÷10. */
  loadVoltage: number;
  /** Stack current, A. IR 76 signed ÷10. */
  current: number;
  /** Stack power, W. IR 79 (GivTCP shows it ÷1000 as kW). */
  power: number;
  /** Highest module state of charge, %. IR 80 high byte. */
  stateOfChargeMax: number;
  /** Lowest module state of charge, %. IR 80 low byte. */
  stateOfChargeMin: number;
  /** State of health, %. IR 81. */
  stateOfHealth: number;
  /** Nominal capacity, Ah. IR 98 ÷10. */
  nominalCapacityAh: number;
  /** Remaining capacity, Ah. IR 99 ÷10. */
  remainingCapacityAh: number;
  /** Charge/discharge cycles, IR 100 ÷10. */
  cycleCount: number;
  /** Minimum discharge voltage, V. IR 102 ÷10. */
  minimumDischargeVoltage: number;
  /** Maximum charge voltage, V. IR 103 ÷10 (GivTCP mislabels it a minimum). */
  maximumChargeVoltage: number;
  /** Minimum discharge current, A. IR 104 ÷10. */
  minimumDischargeCurrent: number;
  /** Maximum charge current, A. IR 105 ÷10 (GivTCP mislabels it a minimum). */
  maximumChargeCurrent: number;
  /** Warning, protection and fault words, raw, IR 114–119 in order. */
  alarmWords: number[];
  energy: {
    /** Energy charged today, kWh. IR 90–91 uint32 ÷10. */
    chargeTodayKwh: number;
    /** Energy discharged today, kWh. IR 92–93 uint32 ÷10. */
    dischargeTodayKwh: number;
    /** Lifetime energy charged, kWh. IR 82–83 uint32 ÷10. */
    chargeTotalKwh: number;
    /** Lifetime energy discharged, kWh. IR 84–85 uint32 ÷10. */
    dischargeTotalKwh: number;
  };
  /** Charge and discharge capacity counters, Ah, raw uint32. */
  capacity: {
    /** IR 94–95. */
    chargeTodayAh: number;
    /** IR 96–97. */
    dischargeTodayAh: number;
    /** IR 86–87. */
    chargeTotalAh: number;
    /** IR 88–89. */
    dischargeTotalAh: number;
  };
}

// ── Grid ─────────────────────────────────────────────────────────────────────

/** Grid energy counters. */
export interface GridEnergy {
  /** Energy imported today, kWh. Single-phase IR 26 ÷10; three-phase IR 1380–1381 uint32 ÷10. */
  importTodayKwh: number;
  /** Energy exported today, kWh. Single-phase IR 25 ÷10; three-phase IR 1384–1385 uint32 ÷10. */
  exportTodayKwh: number;
  /** Lifetime energy imported, kWh. Single-phase IR 32–33 uint32 ÷10; three-phase IR 1382–1383 uint32 ÷10. */
  importTotalKwh: number;
  /** Lifetime energy exported, kWh. Single-phase IR 21–22 uint32 ÷10; three-phase IR 1386–1387 uint32 ÷10. */
  exportTotalKwh: number;
}

export interface Grid {
  /**
   * Net grid power at the grid CT, W. Positive is export, negative is import.
   * Single-phase IR 30 signed (not IR 24, which is the inverter terminal). Three-phase:
   * export IR 1081–1082 minus import IR 1079–1080, each uint32 ÷10 (GivTCP's scaling,
   * unverified).
   */
  power: number;
  /**
   * Grid frequency, Hz. Single-phase IR 13; three-phase IR 1067. Normally ÷100 (5009 is
   * 50.09 Hz), but some firmware reports ÷10 (500 is 50.0 Hz): the raw value is divided by 10,
   * then by 10 again when the result is over 100.
   */
  frequency: number;
  energy: GridEnergy;
}

export interface SinglePhaseGrid extends Grid {
  /**
   * Grid voltage, V. IR 5 ÷10. Measured at the inverter's AC terminal, which is on the same
   * AC bus as the grid connection.
   */
  voltage: number;
}

export interface ThreePhaseGrid extends Grid {
  /** Per-phase grid voltage and current. There is no per-phase grid power register. */
  phases: ThreePhase<{
    /** Phase voltage, V. IR 1061–1063 ÷10. */
    voltage: number;
    /** Phase current, A. IR 1064–1066 ÷10. */
    current: number;
  }>;
}

// ── Inverter ─────────────────────────────────────────────────────────────────

/** Inverter energy counters. */
export interface InverterEnergy {
  /** Energy taken from the grid to charge the battery today, kWh. Single-phase IR 35 ÷10; three-phase IR 1376–1377 uint32 ÷10. */
  acChargeTodayKwh: number;
  /** Lifetime AC charge energy, kWh. Single-phase IR 27–28 uint32 ÷10; three-phase IR 1378–1379 uint32 ÷10. */
  acChargeTotalKwh: number;
  /**
   * Energy out of the inverter's AC side today, kWh. Single-phase IR 44 ÷10; three-phase
   * IR 1360–1361 uint32 ÷10. On single-phase DC hybrids this register counts PV generation;
   * on AC and All in One models it echoes the AC side (inverter output) instead (research C).
   * The app's consumption figure uses it either way.
   */
  outputTodayKwh: number;
  /** Lifetime inverter output energy, kWh. Single-phase IR 45–46 uint32 ÷10 (same caveat as `outputTodayKwh`); three-phase IR 1362–1363 uint32 ÷10. */
  outputTotalKwh: number;
}

export interface InverterOutput {
  /**
   * Real power at the inverter's AC terminal, W. Positive is delivering. Single-phase IR 24
   * signed; three-phase IR 1069–1070 signed int32 ÷10.
   */
  outputPower: number;
  /** Apparent power at the inverter's AC terminal, VA. Single-phase IR 43; three-phase IR 1073–1074 uint32 ÷10. */
  apparentPower: number;
  /** Heatsink temperature, °C. Single-phase IR 41 signed ÷10; three-phase IR 1128 signed ÷10. */
  heatsinkTemperature: number;
  energy: InverterEnergy;
}

export interface SinglePhaseInverterOutput extends InverterOutput {
  /** AC output current, A. IR 10 ÷10. */
  current: number;
  /**
   * Output power factor, −1 to 1. IR 16 as raw ÷10000 − 1 (offset-unsigned, like HR 52).
   * Three-phase IR 1068 is not exposed: its scaling is unknown.
   */
  powerFactor: number;
  /** Current at the inverter's AC terminal (doc `i_grid_port`), A. IR 58 ÷100. */
  terminalCurrent: number;
  /** Positive DC bus voltage, V. IR 3 ÷10. */
  positiveBusVoltage: number;
  /** Negative DC bus voltage, V. IR 4 ÷10. */
  negativeBusVoltage: number;
  /** High-voltage bus voltage (doc `v_highbrigh_bus`), V. IR 15 ÷10. Meaning unconfirmed. */
  highVoltageBusVoltage: number;
}

export interface ThreePhaseInverterOutput extends InverterOutput {
  /** Per-phase inverter output. There is no per-phase inverter current register. */
  phases: ThreePhase<{
    /** Phase output voltage, V. IR 1094–1096 ÷10. */
    voltage: number;
    /** Phase output power, W. IR 1091–1093 signed (not ÷10). */
    power: number;
  }>;
  /** AC charge power, W. IR 1071–1072 uint32 ÷10. */
  acChargePower: number;
  /** Boost converter temperature, °C. IR 1129 signed ÷10. */
  boostTemperature: number;
  /** Buck-boost converter temperature, °C. IR 1130 signed ÷10. */
  buckBoostTemperature: number;
  /** DC bus voltage, V. IR 1134 ÷10. */
  dcBusVoltage: number;
  /** Inverter bus voltage, V. IR 1135 ÷10. */
  inverterBusVoltage: number;
}

// ── EPS ──────────────────────────────────────────────────────────────────────

export interface Eps {
  /** EPS (backup) output power, W. Single-phase IR 31; three-phase: the sum of the phases. */
  power: number;
  /** EPS frequency, Hz. Single-phase IR 54; three-phase nominal IR 1180. Scaled as grid frequency (÷100, or ÷10 on some firmware). */
  frequency: number;
}

export interface SinglePhaseEps extends Eps {
  /** EPS output voltage, V. IR 53 ÷10. */
  voltage: number;
}

export interface ThreePhaseEps extends Eps {
  phases: ThreePhase<{
    /** Phase voltage, V. IR 1181–1183 ÷10. */
    voltage: number;
    /** Phase current, A. IR 1184–1186 ÷10. */
    current: number;
    /** Phase power, W. IR 1187–1188, 1189–1190, 1191–1192, each uint32 ÷10. */
    power: number;
  }>;
}

// ── Load ─────────────────────────────────────────────────────────────────────

export interface Load {
  /**
   * House load, W. Single-phase IR 42, sensed independently (not IR 24 − IR 30) and already
   * including any EPS load, so don't add `eps.power`. Three-phase IR 1089–1090 uint32 ÷10 (GivTCP's scaling, unverified).
   */
  power: number;
  /**
   * Energy consumed today, kWh. Single-phase is derived as the app does: grid import − grid
   * export + inverter output (IR 44) − AC charge (IR 35). Three-phase IR 1396–1397 uint32 ÷10.
   */
  energyTodayKwh: number;
  /**
   * Lifetime energy consumed, kWh. Single-phase is derived: import total − export total +
   * IR 45–46 − IR 27–28 (matches the app exactly on the reference unit). Three-phase
   * IR 1398–1399 uint32 ÷10.
   */
  energyTotalKwh: number;
}

export type SinglePhaseLoad = Load;

export interface ThreePhaseLoad extends Load {
  /** Per-phase load. Only power is reported. */
  phases: ThreePhase<{
    /** Phase load power, W. IR 1083–1085 signed (not ÷10). */
    power: number;
  }>;
}

// ── Schedules ────────────────────────────────────────────────────────────────

/** Battery pause (single-phase HR 318–320). */
export interface BatteryPause {
  /** HR 318: 0 off, 1 pause charging, 2 pause discharging, 3 pause both. */
  mode: 'off' | 'charge' | 'discharge' | 'both';
  /**
   * Pause start, `"HH:MM"`. HR 319 (no swap). Present only when `capabilities.pauseWindow`:
   * Gen1 rejects any access touching HR 319/320. Setting a window in the app also sets
   * HR 318 to 3.
   */
  start?: string;
  /** Pause end, `"HH:MM"`. HR 320. Present only when `capabilities.pauseWindow`. */
  end?: string;
}

/** Charge and discharge slots. */
export interface Schedules {
  /**
   * AC charge slots, slot 1 first. 10 slots when `capabilities.tenSlots`, otherwise 2.
   * Single-phase: slot 1 HR 94/95; slot 2 HR 243/244 on 10-slot firmware (HR 31/32 before);
   * slots 3–10 HR 246–269, three registers each (start, end, target); slot 1/2 targets HR 242/245.
   * Three-phase: slots 1/2 HR 1113–1116, slots 3–10 as single-phase.
   */
  charge: TimeSlotConfig[];
  /**
   * DC discharge slots, slot 1 first. 10 slots when `capabilities.tenSlots`, otherwise 2.
   * Single-phase: slot 1 HR 56/57, slot 2 HR 44/45, slots 3–10 HR 276–299; slot 1/2 targets
   * HR 272/275. Three-phase: slots 1/2 HR 1118–1121, slots 3–10 as single-phase.
   */
  discharge: TimeSlotConfig[];
}

export interface SinglePhaseSchedules extends Schedules {
  /** Battery pause. Present when `capabilities.pauseMode`. Three-phase has no pause controls. */
  batteryPause?: BatteryPause;
}

export type ThreePhaseSchedules = Schedules;

// ── Meters ───────────────────────────────────────────────────────────────────

/**
 * A GivEnergy CT meter at device address 0x01–0x08: data from IR 60–88 (function 4),
 * product information from function 22 registers 60–66. Single-phase meters report 0
 * on phases 2 and 3.
 */
export interface Meter {
  /** Device address, 1–8. */
  slaveAddress: number;
  /** Serial number, product registers 60–61 uint32 (a number, not a string). */
  serialNumber: number;
  /** Factory code, product registers 62–63 (4 ASCII characters, e.g. `"GivE"`). */
  factoryCode: string;
  /** Meter type code, product register 64 (e.g. 33). */
  meterType: number;
  /** Hardware version, product register 65. */
  hardwareVersion: number;
  /** Software version, product register 66 (e.g. 518). */
  softwareVersion: number;
  /** Phase voltage, V. IR 60–62 ÷10. */
  voltage: ThreePhase<number>;
  /** Phase current, A. IR 63–65 ÷100. */
  current: ThreePhase<number>;
  /** Phase active power, W, signed (negative is import). IR 68–70. */
  activePower: ThreePhase<number>;
  /** Total active power, W, signed. IR 71. */
  activePowerTotal: number;
  /** Phase reactive power, var, signed. IR 72–74. */
  reactivePower: ThreePhase<number>;
  /** Total reactive power, var, signed. IR 75. */
  reactivePowerTotal: number;
  /** Phase apparent power, VA. IR 76–78 signed ÷10. */
  apparentPower: ThreePhase<number>;
  /** Total apparent power, VA. IR 79 signed ÷10. */
  apparentPowerTotal: number;
  /** Phase power factor, −1 to 1. IR 80–82 signed ÷10000. */
  powerFactor: ThreePhase<number>;
  /** Total power factor, −1 to 1. IR 83 signed ÷10000. */
  powerFactorTotal: number;
  /** Frequency, Hz. IR 84 ÷100. */
  frequency: number;
  /** Active energy imported, kWh. IR 85 ÷10 (16-bit, wraps at 6553.5). */
  importActiveEnergyKwh: number;
  /** Reactive energy imported, kvarh. IR 86 ÷10. */
  importReactiveEnergyKvarh: number;
  /** Active energy exported, kWh. IR 87 ÷10 (16-bit, wraps at 6553.5). */
  exportActiveEnergyKwh: number;
  /** Reactive energy exported, kvarh. IR 88 ÷10. */
  exportReactiveEnergyKvarh: number;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export interface SinglePhaseSnapshot {
  layout: 'single_phase';
  model: SinglePhaseModel;
  capabilities: Capabilities;
  identity: Identity<SinglePhaseModel>;
  status: SinglePhaseStatus;
  solar: SinglePhaseSolar;
  battery: SinglePhaseBattery;
  grid: SinglePhaseGrid;
  inverter: SinglePhaseInverterOutput;
  eps: SinglePhaseEps;
  load: SinglePhaseLoad;
  /** Directional power flows derived from solar, battery, grid and load power. */
  powerFlows: PowerFlows;
  meters: Meter[];
  /** Every catalogue setting for this layout. Gated settings are absent when unsupported. */
  settings: SinglePhaseSettings;
  schedules: SinglePhaseSchedules;
}

export interface ThreePhaseSnapshot {
  layout: 'three_phase';
  model: ThreePhaseModel;
  capabilities: Capabilities;
  identity: ThreePhaseIdentity;
  status: ThreePhaseStatus;
  solar: Solar<ThreePhaseSolarString>;
  battery: ThreePhaseBattery;
  grid: ThreePhaseGrid;
  inverter: ThreePhaseInverterOutput;
  eps: ThreePhaseEps;
  load: ThreePhaseLoad;
  /** Directional power flows derived from solar, battery, grid and load power. */
  powerFlows: PowerFlows;
  meters: Meter[];
  /** Every catalogue setting for this layout. Gated settings are absent when unsupported. */
  settings: ThreePhaseSettings;
  schedules: ThreePhaseSchedules;
}

export type InverterSnapshot = SinglePhaseSnapshot | ThreePhaseSnapshot;
