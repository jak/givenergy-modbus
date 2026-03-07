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
 * GivEnergy inverters ship with RTC defaulted to year 2000.
 * If the inverter hasn't synced time (NTP failure or no internet),
 * it reports year 2000 timestamps which are meaningless.
 *
 * Fallback chain:
 * 1. If year != 2000: use reported time
 * 2. If year == 2000 and previous time cached: use previous
 * 3. If year == 2000 and no cache: use current local time
 *
 * Reference: GivTCP read.py lines 814-823
 *
 * @param reportedTime - Time reported by inverter
 * @param previousTime - Last valid time, or null if no history
 */
export function applyTimeFallback(
  reportedTime: Date,
  previousTime: Date | null,
): Date {
  if (reportedTime.getFullYear() !== 2000) {
    return reportedTime;
  }
  if (previousTime !== null) {
    return previousTime;
  }
  return new Date();
}

export interface EnergyRegisterResult {
  charge: number;
  discharge: number;
}

/**
 * Fall back to secondary energy registers when primary registers are zero.
 *
 * Some GivEnergy firmware versions do not populate the primary battery
 * energy registers (from the BMS). Secondary registers (sourced from
 * the inverter's own metering) contain the same data.
 *
 * Only fall back when BOTH primary values are zero — a single zero is
 * valid (e.g. a battery that has only ever been charged, never discharged).
 *
 * Reference: GivTCP read.py lines 1001-1007
 *
 * @param primaryCharge - Primary battery charge total (kWh)
 * @param primaryDischarge - Primary battery discharge total (kWh)
 * @param secondaryCharge - Backup charge register value
 * @param secondaryDischarge - Backup discharge register value
 */
export function applyEnergyRegisterFallback(
  primaryCharge: number,
  primaryDischarge: number,
  secondaryCharge: number,
  secondaryDischarge: number,
): EnergyRegisterResult {
  if (primaryCharge === 0 && primaryDischarge === 0) {
    return { charge: secondaryCharge, discharge: secondaryDischarge };
  }
  return { charge: primaryCharge, discharge: primaryDischarge };
}

/**
 * Convert raw AC frequency register to Hz, handling firmware unit inconsistency.
 *
 * GivEnergy firmware versions differ in frequency units (#7):
 * - Standard firmware: raw value in deci-Hz (e.g. 500 = 50.0Hz)
 * - Old firmware: raw value in centi-Hz (e.g. 5000 = 50.00Hz)
 *
 * Apply toDeci first to get a base value, then divide by 10 if still > 100.
 * This matches GivTCP where f_ac1 already has deci applied before the check.
 *
 * @param rawFrequency - Raw register value from IR(13)
 * @returns Frequency in Hz
 */
export function applyFrequencyScaling(rawFrequency: number): number {
  const deci = rawFrequency / 10;
  return deci > 100 ? deci / 10 : deci;
}
