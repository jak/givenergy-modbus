/**
 * Power groups: solar, grid, inverter output, EPS and load, for both layouts.
 * Single-phase reads IR 1–59 and IR 247–248; three-phase reads IR 1001–1192.
 *
 * These builders fill the instantaneous values and the per-string solar counters. The group-level
 * energy counters (`solar.energy*Kwh`, `grid.energy`, `inverter.energy`, `load.energy*Kwh`) are
 * built by `energy.ts`, so the return types here leave them out.
 *
 * Single-phase measurement points (external library, inverter.py IR block notes): IR 24, 43 and
 * 58 are the inverter's AC terminal; IR 30 is the grid CT; IR 42 is the house load, sensed
 * independently and already including the EPS load.
 */
import type { InverterModel } from '../model/models.js';
import type {
  SinglePhaseEps,
  SinglePhaseGrid,
  SinglePhaseInverterOutput,
  SinglePhaseLoad,
  SinglePhaseSolar,
  Solar,
  SolarString,
  ThreePhase,
  ThreePhaseEps,
  ThreePhaseGrid,
  ThreePhaseInverterOutput,
  ThreePhaseLoad,
  ThreePhaseSolarString,
} from '../model/snapshot.js';
import {
  frequencyScale,
  toCenti,
  toDeci,
  toInt16,
  toInt32,
  toOffsetPowerFactor,
  toSignedDeci,
  toUint32,
} from '../model/converters.js';
import {
  readInput,
  type BuildContext,
  type RegisterCaches,
  type SinglePhaseBuildContext,
  type ThreePhaseBuildContext,
} from './read.js';

type SolarEnergyKey = 'energyTodayKwh' | 'energyTotalKwh' | 'diverterEnergyKwh';

/** `solar` without its group-level energy counters (built in energy.ts). */
export type SinglePhaseSolarPower = Omit<SinglePhaseSolar, SolarEnergyKey>;
export type ThreePhaseSolarPower = Omit<Solar<ThreePhaseSolarString>, SolarEnergyKey>;
export type SinglePhaseGridPower = Omit<SinglePhaseGrid, 'energy'>;
export type ThreePhaseGridPower = Omit<ThreePhaseGrid, 'energy'>;
export type SinglePhaseInverterPower = Omit<SinglePhaseInverterOutput, 'energy'>;
export type ThreePhaseInverterPower = Omit<ThreePhaseInverterOutput, 'energy'>;
export type SinglePhaseLoadPower = Omit<SinglePhaseLoad, 'energyTodayKwh' | 'energyTotalKwh'>;
export type ThreePhaseLoadPower = Omit<ThreePhaseLoad, 'energyTodayKwh' | 'energyTotalKwh'>;

/**
 * Models with no DC string: AC-coupled units and the All in One. Their PV voltage and current
 * registers echo the AC side (the All in One's IR 1 equals IR 5), but the PV power and energy
 * registers still count generation metered on the AC side. The external library lists `ac` and
 * `all_in_one` (`pv_string_vi_ac_derived`); `ac_3ph` is added on the same structural argument.
 */
const NO_PV_STRING_MODELS: ReadonlySet<InverterModel> = new Set<InverterModel>(['ac', 'all_in_one', 'ac_3ph']);

/** Frequency in Hz, rounded to 0.01 Hz to drop the float error of dividing twice. */
function frequency(raw: number): number {
  return Math.round(frequencyScale(raw) * 100) / 100;
}

/** Round to one decimal place, for sums of ÷10 values. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function reader(registers: RegisterCaches) {
  const ir = (address: number) => readInput(registers, address) ?? 0;
  return {
    ir,
    uint32: (high: number) => toUint32(ir(high), ir(high + 1)),
    phases: <T>(build: (phase: 0 | 1 | 2) => T): ThreePhase<T> => [build(0), build(1), build(2)],
  };
}

// ── Solar ────────────────────────────────────────────────────────────────────

export function buildSolar(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseSolarPower;
export function buildSolar(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseSolarPower;
export function buildSolar(registers: RegisterCaches, context: BuildContext): SinglePhaseSolarPower | ThreePhaseSolarPower;
export function buildSolar(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseSolarPower | ThreePhaseSolarPower {
  const { ir, uint32 } = reader(registers);
  const hasStrings = !NO_PV_STRING_MODELS.has(context.model);

  if (context.layout === 'three_phase') {
    // String n: voltage IR 1001+n, current IR 1009+n, power IR 1017+2n (uint32 ÷10),
    // energy today IR 1366+4n and total IR 1368+4n (uint32 ÷10).
    const strings = ([0, 1] as const).map((n): ThreePhaseSolarString => ({
      voltage: toDeci(ir(1001 + n)),
      current: toDeci(ir(1009 + n)),
      power: toDeci(uint32(1017 + 2 * n)),
      energyTodayKwh: toDeci(uint32(1366 + 4 * n)),
      energyTotalKwh: toDeci(uint32(1368 + 4 * n)),
    }));
    return {
      power: round1(strings[0].power + strings[1].power),
      strings: hasStrings ? strings : [],
    };
  }

  // String n: voltage IR 1+n, current IR 8+n, power IR 18+2n, energy today IR 17+2n.
  const strings = ([0, 1] as const).map((n): SolarString => ({
    voltage: toDeci(ir(1 + n)),
    current: toDeci(ir(8 + n)),
    power: ir(18 + 2 * n),
    energyTodayKwh: toDeci(ir(17 + 2 * n)),
  }));
  const combinedHigh = readInput(registers, 247);
  const combinedLow = readInput(registers, 248);
  return {
    power: ir(18) + ir(20),
    strings: hasStrings ? strings : [],
    ...(combinedHigh !== undefined && combinedLow !== undefined
      ? { combinedGenerationPower: toUint32(combinedHigh, combinedLow) }
      : {}),
  };
}

// ── Grid ─────────────────────────────────────────────────────────────────────

export function buildGrid(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseGridPower;
export function buildGrid(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseGridPower;
export function buildGrid(registers: RegisterCaches, context: BuildContext): SinglePhaseGridPower | ThreePhaseGridPower;
export function buildGrid(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseGridPower | ThreePhaseGridPower {
  const { ir, uint32, phases } = reader(registers);

  if (context.layout === 'three_phase') {
    return {
      // Meter export IR 1081–1082 minus import IR 1079–1080, each uint32 ÷10 (GivTCP's scaling).
      power: round1(toDeci(uint32(1081)) - toDeci(uint32(1079))),
      frequency: frequency(ir(1067)),
      phases: phases((p) => ({ voltage: toDeci(ir(1061 + p)), current: toDeci(ir(1064 + p)) })),
    };
  }

  return {
    // IR 30 is the grid CT; IR 24 (the inverter terminal) is `inverter.outputPower`.
    power: toInt16(ir(30)),
    voltage: toDeci(ir(5)),
    frequency: frequency(ir(13)),
  };
}

// ── Inverter output ──────────────────────────────────────────────────────────

export function buildInverterOutput(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseInverterPower;
export function buildInverterOutput(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseInverterPower;
export function buildInverterOutput(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseInverterPower | ThreePhaseInverterPower;
export function buildInverterOutput(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseInverterPower | ThreePhaseInverterPower {
  const { ir, uint32, phases } = reader(registers);

  if (context.layout === 'three_phase') {
    return {
      outputPower: toDeci(toInt32(ir(1069), ir(1070))),
      apparentPower: toDeci(uint32(1073)),
      heatsinkTemperature: toSignedDeci(ir(1128)),
      // Per-phase power IR 1091–1093 is signed W, not ÷10 (research C).
      phases: phases((p) => ({ voltage: toDeci(ir(1094 + p)), power: toInt16(ir(1091 + p)) })),
      acChargePower: toDeci(uint32(1071)),
      boostTemperature: toSignedDeci(ir(1129)),
      buckBoostTemperature: toSignedDeci(ir(1130)),
      dcBusVoltage: toDeci(ir(1134)),
      inverterBusVoltage: toDeci(ir(1135)),
    };
  }

  return {
    outputPower: toInt16(ir(24)),
    apparentPower: ir(43),
    // An unread IR 16 would decode as −1, so treat it as unity (raw 10000).
    powerFactor: toOffsetPowerFactor(readInput(registers, 16) ?? 10000),
    heatsinkTemperature: toSignedDeci(ir(41)),
    current: toDeci(ir(10)),
    terminalCurrent: toCenti(ir(58)),
    positiveBusVoltage: toDeci(ir(3)),
    negativeBusVoltage: toDeci(ir(4)),
    highVoltageBusVoltage: toDeci(ir(15)),
  };
}

// ── EPS ──────────────────────────────────────────────────────────────────────

export function buildEps(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseEps;
export function buildEps(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseEps;
export function buildEps(registers: RegisterCaches, context: BuildContext): SinglePhaseEps | ThreePhaseEps;
export function buildEps(registers: RegisterCaches, context: BuildContext): SinglePhaseEps | ThreePhaseEps {
  const { ir, uint32, phases } = reader(registers);

  if (context.layout === 'three_phase') {
    const epsPhases = phases((p) => ({
      voltage: toDeci(ir(1181 + p)),
      current: toDeci(ir(1184 + p)),
      power: toDeci(uint32(1187 + 2 * p)),
    }));
    return {
      power: round1(epsPhases[0].power + epsPhases[1].power + epsPhases[2].power),
      frequency: frequency(ir(1180)),
      phases: epsPhases,
    };
  }

  return {
    power: ir(31),
    voltage: toDeci(ir(53)),
    frequency: frequency(ir(54)),
  };
}

// ── Load ─────────────────────────────────────────────────────────────────────

export function buildLoad(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseLoadPower;
export function buildLoad(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseLoadPower;
export function buildLoad(registers: RegisterCaches, context: BuildContext): SinglePhaseLoadPower | ThreePhaseLoadPower;
export function buildLoad(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseLoadPower | ThreePhaseLoadPower {
  const { ir, uint32, phases } = reader(registers);

  if (context.layout === 'three_phase') {
    return {
      power: toDeci(uint32(1089)),
      // Per-phase load IR 1083–1085 is signed W, not ÷10 (research C).
      phases: phases((p) => ({ power: toInt16(ir(1083 + p)) })),
    };
  }

  // IR 42 already includes the EPS load; don't add IR 31.
  return { power: ir(42) };
}
