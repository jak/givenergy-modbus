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
  /** PV string 1 power in watts (IR 18) */
  pvString1Power: number;
  /** PV string 2 power in watts (IR 20) */
  pvString2Power: number;
  /** Battery power: positive = discharging, negative = charging (IR 52, signed int16) */
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

  // Battery state
  /** State of charge 0-100% from IR(59), with fallback applied */
  stateOfCharge: number;
  /** Battery voltage in V from IR(50) via toDeci */
  batteryVoltage: number;
  /** Battery current in A from IR(51) via toInt16 */
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

  // Temperature
  /** Inverter heatsink temperature in °C from IR(41) via toDeci */
  inverterHeatsinkTemp: number;
  /** Charger temperature in °C from IR(55) via toDeci — labeled "BMS Temperature" in cloud CSV */
  chargerTemperature: number;
  /** Battery temperature in °C from IR(56) via toDeci */
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
  /** PV energy generated today in kWh — e_pv1_day IR(17) + e_pv2_day IR(19) via toDeci */
  pvEnergyTodayKwh: number;
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

  /** Enable charge flag from HR(96) */
  enableCharge: boolean;
  /** Enable discharge flag from HR(59) */
  enableDischarge: boolean;
  /** Legacy charge target SOC % from HR(116) — applies to slot 1 on Gen2 */
  chargeTargetStateOfCharge: number;

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
}

export interface ThreePhaseSnapshot extends BaseSnapshot {
  generation: 'three_phase';
  /** Charge timeslots — start/end only, no per-slot target state of charge */
  chargeSlots: TimeSlot[];
  /** Discharge timeslots — start/end only, no per-slot target state of charge */
  dischargeSlots: TimeSlot[];
}

export type InverterSnapshot = Gen2Snapshot | Gen3Snapshot | ThreePhaseSnapshot;
