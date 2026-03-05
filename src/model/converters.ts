/**
 * Register value converters for GivEnergy inverter data.
 *
 * GivEnergy stores values in various scaled integer formats in Modbus registers.
 * These functions convert raw register values to meaningful engineering units.
 *
 * Reference: GivTCP/givenergy_modbus_async/model/register.py Converter class
 */

import type { TimeSlot } from './register-types.js';

/** Divide by 1000 — millivolt, milliamp registers (e.g. battery cell voltages IR 60-75) */
export function toMilli(raw: number): number {
  return raw / 1000;
}

/** Divide by 10 — voltage, temperature, energy registers (e.g. PV voltage IR 1) */
export function toDeci(raw: number): number {
  return raw / 10;
}

/** Divide by 100 — battery voltage, modbus version (e.g. battery voltage IR 50) */
export function toCenti(raw: number): number {
  return raw / 100;
}

/**
 * Combine two consecutive 16-bit registers into a 32-bit unsigned value.
 * High word comes first (big-endian register order).
 *
 * Used for energy totals, work time, etc. which span two registers.
 * Example: e_pv_total at IR(11, 12): toUint32(IR11, IR12)
 */
export function toUint32(high: number, low: number): number {
  return ((high & 0xFFFF) * 0x10000) + (low & 0xFFFF);
}

/**
 * Interpret a raw 16-bit register value as a signed integer (two's complement).
 * Used for registers that can be negative: battery power (IR 52), grid power (IR 30),
 * battery current (IR 51), inverter output power (IR 24).
 */
export function toInt16(raw: number): number {
  return raw > 0x7FFF ? raw - 0x10000 : raw;
}

/**
 * Convert an array of 16-bit Modbus register values to an ASCII string.
 * Each register contributes 2 characters (high byte first, low byte second).
 *
 * Used for serial numbers (HR 13-17 = 5 registers = 10 chars),
 * and battery serial numbers (IR 110-114 = 5 registers = 10 chars).
 */
export function registersToString(registers: number[]): string {
  return registers
    .map(r => String.fromCharCode((r >> 8) & 0xFF, r & 0xFF))
    .join('');
}

/**
 * Split a 16-bit register into two 8-bit values [high byte, low byte].
 *
 * Used for HR(43) which packs charge_soc (high byte) and discharge_soc (low byte),
 * and for battery status registers at IR(90-93).
 */
export function toDuint8(raw: number): [number, number] {
  return [(raw >> 8) & 0xFF, raw & 0xFF];
}

/**
 * Convert a pair of raw register values to a TimeSlot.
 *
 * Register format: integer HHMM (e.g. 0 = 00:00, 30 = 00:30, 1630 = 16:30, 2359 = 23:59).
 * Used for charge/discharge time slots (e.g. HR 94-95, 56-57).
 */
export function toTimeslot(startRaw: number, endRaw: number): TimeSlot {
  const fmt = (v: number): string => {
    const h = Math.floor(v / 100);
    const m = v % 100;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  return { start: fmt(startRaw), end: fmt(endRaw) };
}

/**
 * GivEnergy firmware frequency unit inconsistency workaround.
 *
 * Some firmware versions report AC frequency in a larger unit (values > 100),
 * while others report in a smaller unit. Values > 100 are divided by 10.
 *
 * After this function, apply toDeci() to get Hz.
 * - Old firmware: 5000 → frequencyScale → 500 → toDeci → 50Hz
 * - Newer firmware: 500 → frequencyScale → 50 → toDeci → 5Hz (!) — caller handles
 *
 * Reference: GivTCP read.py lines 1227-1236
 * Python: if GEInv.f_ac1 > 100: freq = GEInv.f_ac1 / 10
 */
export function frequencyScale(raw: number): number {
  return raw > 100 ? raw / 10 : raw;
}

/**
 * Calculate usable capacity for HV (High Voltage) battery stacks.
 *
 * GivEnergy HV batteries report nominal capacity per module, but the battery
 * management system reserves 10% as a hardware protection buffer. Only 90%
 * of the aggregated nominal capacity is available to the inverter.
 *
 * This is a hardware characteristic, not a software limitation.
 *
 * Reference: GivTCP read.py lines 438-439
 * Python: round((stack[0].battery_nominal_capacity * stack[0].number_of_module) * 0.9, 2)
 *
 * @param nominalCapacityKwh - Per-module nominal capacity in kWh
 * @param moduleCount - Number of modules in the stack
 * @returns Usable capacity in kWh, rounded to 2 decimal places
 */
export function hvCapacityUsable(nominalCapacityKwh: number, moduleCount: number): number {
  return Math.round(nominalCapacityKwh * moduleCount * 0.9 * 100) / 100;
}
