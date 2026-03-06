/**
 * Meter snapshot — decoded state of a GivEnergy CT meter at a point in time.
 *
 * Data is read from meter slave addresses (0x01–0x08) using fc=4 (IR 60–88)
 * and fc=22 (product registers MR 60–68).
 *
 * Three-phase meters report per-phase values; single-phase meters have
 * zero for phases 2 and 3.
 *
 * Reference: GivTCP/givenergy_modbus_async/model/meter.py
 */

/** Per-phase electrical measurements as a 3-element tuple [phase1, phase2, phase3] */
export type ThreePhase<T> = [T, T, T];

export interface MeterSnapshot {
  /** Meter slave address (1–8) */
  slaveAddress: number;

  // Product info (from fc=22 product registers)
  /** Numeric serial number — uint32 from MR(60,61) */
  serialNumber: number;
  /** 4-character factory code string from MR(62,63), e.g. "GivE" */
  factoryCode: string;
  /** Meter type code from MR(64) */
  meterType: number;
  /** Hardware version from MR(65) */
  hardwareVersion: number;
  /** Software version from MR(66) */
  softwareVersion: number;

  // Voltage (V) — per phase, toDeci
  voltage: ThreePhase<number>;

  // Current (A) — per phase, toCenti
  current: ThreePhase<number>;

  // Active power (W) — per phase, signed (negative = import)
  activePower: ThreePhase<number>;
  /** Total active power across all phases (W), signed */
  activePowerTotal: number;

  // Reactive power (VAR) — per phase, signed
  reactivePower: ThreePhase<number>;
  /** Total reactive power (VAR) */
  reactivePowerTotal: number;

  // Apparent power (VA) — per phase, signed
  apparentPower: ThreePhase<number>;
  /** Total apparent power (VA) */
  apparentPowerTotal: number;

  // Power factor — per phase, -1.0..1.0
  powerFactor: ThreePhase<number>;
  /** Total power factor */
  powerFactorTotal: number;

  /** Grid frequency in Hz — toCenti */
  frequency: number;

  // Energy totals (kWh) — single 16-bit toDeci, overflows at 6553.5 kWh
  /** Active energy imported (kWh) */
  importActiveEnergyKwh: number;
  /** Reactive energy imported (kVARh) */
  importReactiveEnergy: number;
  /** Active energy exported (kWh) */
  exportActiveEnergyKwh: number;
  /** Reactive energy exported (kVARh) */
  exportReactiveEnergy: number;
}
