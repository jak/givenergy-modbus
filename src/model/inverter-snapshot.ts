/**
 * InverterSnapshot — full decoded state of a GivEnergy inverter at a point in time.
 *
 * Assembled by buildSnapshot() in snapshot-builder.ts from raw Modbus register caches.
 * All GivEnergy protocol quirks (validation, fallbacks, scaling) have been applied.
 *
 * The type is a discriminated union on `generation` so that timeslot types are
 * accurate per generation: Gen3 timeslots carry `targetStateOfCharge`; Gen2 and
 * three_phase timeslots do not.
 */
import type { TimeSlot, TimeSlotConfig } from './register-types.js';
import type { BatterySnapshot } from './battery-snapshot.js';
import type { MeterSnapshot } from './meter-snapshot.js';
import type { PowerFlows } from '../power-flow.js';

/**
 * Battery pause mode — Gen3-only feature.
 *
 * Controls whether the battery is paused from charging, discharging, or both.
 * 'disabled' means normal operation. This is independent of the timed charge/export
 * toggles and timeslot configuration.
 *
 * HR(318): 0=disabled, 1=pause_charge, 2=pause_discharge, 3=pause_both.
 *
 * Terminology note: GivTCP calls HR(59) "enable_discharge" and doesn't model
 * timed discharge separately. This library follows the GivEnergy app's terminology
 * instead, where HR(59) is "timed export" (export to grid) and HR(318) is
 * "battery pause mode" with an associated "timed discharge" slot (HR 319-320).
 */
export type BatteryPauseMode = 'disabled' | 'pause_charge' | 'pause_discharge' | 'pause_both';

/** Fields shared by all inverter generations */
interface BaseSnapshot {
  // Identity
  /** 10-character inverter serial number from HR(13-17) */
  serialNumber: string;
  /** Raw device type code from HR(0) — encodes model family and generation */
  modelCode: number;

  // Real-time power (watts)
  /** Total solar generation: p_pv1 (IR 18) + p_pv2 (IR 20) */
  solarPower: number;
  /** PV string 1 power in watts (IR 18) — one of the two DC inputs on the inverter */
  pvString1Power: number;
  /** PV string 2 power in watts (IR 20) — the second DC input on the inverter */
  pvString2Power: number;
  /**
   * Battery power as seen by the inverter's DC bus (IR 52, signed int16).
   * Positive = discharging into the house, negative = charging from solar/grid.
   *
   * This is the system-wide battery power. For per-module detail, see
   * BatterySnapshot — though note that individual battery modules don't
   * report their own power directly.
   */
  batteryPower: number;
  /** Grid power: positive = export, negative = import (IR 30, signed int16) */
  gridPower: number;
  /** Load demand in watts (IR 42) */
  loadPower: number;
  /** Inverter AC output power in watts (IR 24, signed int16) */
  inverterOutputPower: number;
  /** Grid apparent power in VA (IR 43) */
  gridApparentPower: number;
  /** EPS backup output power in watts (IR 31) */
  epsBackupPower: number;

  // PV string measurements
  /** PV string 1 voltage in V (IR 1, toDeci) */
  pvString1Voltage: number;
  /** PV string 2 voltage in V (IR 2, toDeci) */
  pvString2Voltage: number;
  /** PV string 1 current in A (IR 8, toDeci) */
  pvString1Current: number;
  /** PV string 2 current in A (IR 9, toDeci) */
  pvString2Current: number;

  // Battery state (inverter-level measurements)
  //
  // These come from the inverter's own battery monitoring circuit (IR 50–59).
  // For per-module data from the BMS itself — including cell voltages,
  // temperatures, and individual charge/discharge totals — see BatterySnapshot
  // in the `batteries` array.
  //
  /** State of charge 0-100% from IR(59), with fallback applied */
  stateOfCharge: number;
  /** Battery voltage in V from IR(50) via toCenti — measured at the inverter's DC bus */
  batteryVoltage: number;
  /** Battery current in A from IR(51) via toInt16 then toCenti */
  batteryCurrent: number;

  // Grid
  /** AC grid voltage in V from IR(5) via toDeci */
  gridVoltage: number;
  /** AC grid frequency in Hz from IR(13), with firmware scaling applied */
  gridFrequency: number;
  /** Inverter AC current in A from IR(10) via toDeci */
  inverterCurrent: number;

  // EPS backup
  /** EPS backup voltage in V from IR(53) via toDeci */
  epsBackupVoltage: number;
  /** EPS backup frequency in Hz from IR(54) via toCenti */
  epsBackupFrequency: number;

  // Temperature (inverter-level sensors)
  //
  // These are measured by the inverter's own sensors. For the battery module's
  // own temperature readings (which include per-cell min/max from the BMS),
  // see BatterySnapshot.temperatureMin and BatterySnapshot.temperatureMax.
  //
  /** Inverter heatsink temperature in °C from IR(41) via toDeci */
  inverterHeatsinkTemp: number;
  /** Charger temperature in °C from IR(55) via toDeci — labeled "BMS Temperature" in the GivEnergy cloud CSV */
  chargerTemperature: number;
  /** Battery temperature in °C from IR(56) via toDeci — a single reading from the inverter's sensor */
  batteryTemperature: number;

  // Energy totals (kWh)
  /** Total PV energy generated in kWh — uint32 IR(11,12) via toDeci */
  pvEnergyTotalKwh: number;
  /** Total battery charge energy in kWh */
  batteryChargeEnergyTotalKwh: number;
  /** Total battery discharge energy in kWh */
  batteryDischargeEnergyTotalKwh: number;
  /** Total grid import energy in kWh — uint32 IR(32,33) via toDeci */
  gridImportEnergyTotalKwh: number;
  /** Total grid export energy in kWh — uint32 IR(21,22) via toDeci */
  gridExportEnergyTotalKwh: number;
  /** Total consumption energy in kWh — derived: (inverter_out - ac_charge) - (export - import) */
  consumptionEnergyTotalKwh: number;
  /** Total battery throughput in kWh — uint32 IR(6,7) via toDeci */
  batteryThroughputTotalKwh: number;

  // Inverter lifetime
  /** Total hours of operation — uint32 IR(47,48) */
  hoursOfOperation: number;

  // Energy today (kWh)
  /** PV energy generated today in kWh — sum of both strings: e_pv1_day IR(17) + e_pv2_day IR(19) */
  pvEnergyTodayKwh: number;
  /** PV string 1 energy generated today in kWh — e_pv1_day IR(17) via toDeci */
  pvString1EnergyTodayKwh: number;
  /** PV string 2 energy generated today in kWh — e_pv2_day IR(19) via toDeci */
  pvString2EnergyTodayKwh: number;
  /** Battery charge energy today in kWh — e_battery_charge_today IR(36) via toDeci */
  batteryChargeEnergyTodayKwh: number;
  /** Battery discharge energy today in kWh — e_battery_discharge_today IR(37) via toDeci */
  batteryDischargeEnergyTodayKwh: number;
  /** Grid import energy today in kWh — e_grid_in_day IR(26) via toDeci */
  gridImportEnergyTodayKwh: number;
  /** Grid export energy today in kWh — e_grid_out_day IR(25) via toDeci */
  gridExportEnergyTodayKwh: number;
  /** Consumption energy today in kWh — derived: (inverter_out_day - ac_charge_day) - (export_day - import_day) */
  consumptionEnergyTodayKwh: number;

  /**
   * Eco mode toggle from HR(27).
   * When enabled, battery charges from solar only and discharges to meet load.
   */
  ecoMode: boolean;
  /**
   * Timed export toggle from HR(59).
   * When enabled, battery discharges to grid on schedule.
   * Independent of eco mode — both can be on simultaneously.
   */
  timedExport: boolean;
  /** Timed charge toggle from HR(96) — enables charge schedule slots */
  timedCharge: boolean;
  /** Legacy charge target SOC % from HR(116) — applies to slot 1 on Gen2 */
  chargeTargetStateOfCharge: number;
  /** Minimum SOC the inverter will discharge to (4-100%), from HR(110) or HR(1109) for three-phase */
  batteryReservePercent: number;
  /** Battery charge rate AC limit (0-100%), from HR(313) or HR(1110) for three-phase */
  chargeRatePercent: number;
  /** Battery discharge rate AC limit (0-100%), from HR(314) or HR(1108) for three-phase */
  dischargeRatePercent: number;

  // Inverter time (with year-2000 fallback applied)
  systemTime: Date;

  // Derived power flows
  powerFlows: PowerFlows;

  // Attached batteries
  batteries: BatterySnapshot[];

  // Attached CT meters
  meters: MeterSnapshot[];
}

export interface Gen2Snapshot extends BaseSnapshot {
  generation: 'gen2';
  /** Charge timeslots — start/end only, no per-slot target state of charge */
  chargeSlots: TimeSlot[];
  /** Discharge timeslots — start/end only, no per-slot target state of charge */
  dischargeSlots: TimeSlot[];
}

export interface Gen3Snapshot extends BaseSnapshot {
  generation: 'gen3';
  /** Charge timeslots with per-slot target state of charge */
  chargeSlots: TimeSlotConfig[];
  /** Discharge timeslots with per-slot target state of charge */
  dischargeSlots: TimeSlotConfig[];
  /**
   * Battery pause mode from HR(318) — Gen3-only.
   * Controls whether the battery is paused from charging, discharging, or both.
   * 'disabled' means normal operation. Closely related to the timed discharge
   * feature in the GivEnergy app — setting pause_discharge enables timed discharge.
   */
  batteryPauseMode: BatteryPauseMode;
  /**
   * Timed discharge slot from HR(319-320) — Gen3-only.
   * The time window during which battery discharge is scheduled.
   * In the GivEnergy app this is shown as the "timed discharge" slot.
   */
  timedDischargeSlot: TimeSlot;
}

export interface ThreePhaseSnapshot extends BaseSnapshot {
  generation: 'three_phase';
  /** Charge timeslots — start/end only, no per-slot target state of charge */
  chargeSlots: TimeSlot[];
  /** Discharge timeslots — start/end only, no per-slot target state of charge */
  dischargeSlots: TimeSlot[];
}

export type InverterSnapshot = Gen2Snapshot | Gen3Snapshot | ThreePhaseSnapshot;
