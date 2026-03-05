/**
 * InverterSnapshot — full decoded state of a GivEnergy inverter at a point in time.
 *
 * Assembled by buildSnapshot() in snapshot-builder.ts from raw Modbus register caches.
 * All GivEnergy protocol quirks (validation, fallbacks, scaling) have been applied.
 */
import type { TimeSlot } from './register-types.js';
import type { BatterySnapshot } from './battery-snapshot.js';
import type { PowerFlows } from '../power-flow.js';

export interface InverterSnapshot {
  // Identity
  /** 10-character inverter serial number from HR(13-17) */
  serialNumber: string;
  /** Raw device type code from HR(0) — encodes model family and generation */
  modelCode: number;

  // Real-time power (watts)
  /** Total solar generation: p_pv1 (IR 18) + p_pv2 (IR 20) */
  solarPower: number;
  /** Battery power: positive = charging, negative = discharging (IR 52, signed int16) */
  batteryPower: number;
  /** Grid power: positive = export, negative = import (IR 30, signed int16) */
  gridPower: number;
  /** Load demand in watts (IR 42) */
  loadPower: number;

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

  // Temperature
  /** Inverter heatsink temperature in °C from IR(41) via toDeci */
  inverterHeatsinkTemp: number;

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

  // Charge configuration
  /** Charge time slot 1 from HR(94-95) */
  chargeSlot1: TimeSlot;
  /** Discharge time slot 1 from HR(56-57) */
  dischargeSlot1: TimeSlot;
  /** Enable charge flag from HR(96) */
  enableCharge: boolean;
  /** Enable discharge flag from HR(59) */
  enableDischarge: boolean;
  /** Charge target SOC % from HR(116) */
  chargeTargetStateOfCharge: number;

  // Inverter time (with year-2000 fallback applied)
  systemTime: Date;

  // Derived power flows
  powerFlows: PowerFlows;

  // Attached batteries
  batteries: BatterySnapshot[];
}
