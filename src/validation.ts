/**
 * Data validation and fallback logic for GivEnergy inverter data.
 *
 * GivEnergy inverters have several known data quality issues inherited from
 * firmware bugs, protocol quirks, and hardware limitations. All workarounds
 * are collected here so the rest of the library stays clean.
 *
 * Reference: GivTCP/read.py — processInverterInfo() and related functions
 */

export interface SanityCheckInput {
  modbusVersion: number;
  modbusAddress: number;
  userCode: number;
  heatsinkTemp: number;
}

/**
 * Validate that a register read looks sane before accepting it.
 *
 * GivEnergy inverters occasionally return garbage data — all registers
 * in a block returning implausible values simultaneously. This check
 * catches those cases so we fall back to the previous cached reading.
 *
 * Python: if float(GEInv.modbus_version) > 2 or GEInv.modbus_address > 100
 *           or GEInv.user_code > 100 or GEInv.temp_inverter_heatsink > 100:
 *             return multi_output_old
 *
 * Reference: GivTCP read.py lines 808-811
 */
export function isSanityCheckPassing(data: SanityCheckInput): boolean {
  if (data.modbusVersion > 2) return false;
  if (data.modbusAddress > 100) return false;
  if (data.userCode > 100) return false;
  if (data.heatsinkTemp > 100) return false;
  return true;
}

/**
 * Apply the state-of-charge fallback chain.
 *
 * GivEnergy inverters sometimes report 0% SOC during:
 * - Communication glitches (temporary, not real)
 * - Battery calibration cycles (soc_force_adjust != 0)
 *
 * The fallback chain (from Python):
 * 1. If SOC > 0 OR calibrating: use reported value
 * 2. If SOC = 0 and previous reading exists: use previous
 * 3. If SOC = 0 and no history: default to 1% (not 0%, avoids false "empty" alarms)
 *
 * Reference: GivTCP read.py lines 1167-1176
 *
 * @param reportedSoc - SOC% reported by inverter (0-100)
 * @param previousSoc - Last known good SOC, or null if no history
 * @param isCalibrating - True if soc_force_adjust != 0
 */
export function applyStateOfChargeFallback(
  reportedSoc: number,
  previousSoc: number | null,
  isCalibrating: boolean,
): number {
  if (reportedSoc !== 0 || isCalibrating) {
    return reportedSoc;
  }
  if (previousSoc !== null) {
    return previousSoc;
  }
  return 1;
}

/**
 * Apply the inverter time fallback.
 *
 * Takes raw date components from holding registers HR(35-40) and validates
 * them before constructing a Date. This prevents JavaScript's Date constructor
 * from silently overflowing invalid values (e.g. month=13 → January next year).
 *
 * Fallback chain:
 * 1. If components are valid and year != 2000: construct and use reported time
 * 2. If invalid or year == 2000, and previous time cached: use previous
 * 3. If invalid or year == 2000, and no cache: use current local time
 *
 * Fixes #9: at year boundaries the inverter can report month=13 or other
 * out-of-range components, producing silently wrong dates.
 *
 * @param year - Full year (e.g. 2024), already offset from 2000
 * @param month - Month 1-12 (register value, NOT 0-indexed)
 * @param day - Day 1-31
 * @param hour - Hour 0-23
 * @param minute - Minute 0-59
 * @param second - Second 0-59
 * @param previousTime - Last valid time, or null if no history
 */
export function applyTimeFallback(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  previousTime: Date | null,
): Date {
  const isValid =
    year !== 2000 &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= 31 &&
    hour >= 0 && hour <= 23 &&
    minute >= 0 && minute <= 59 &&
    second >= 0 && second <= 59;

  if (isValid) {
    return new Date(year, month - 1, day, hour, minute, second);
  }
  if (previousTime !== null) {
    return previousTime;
  }
  return new Date();
}

