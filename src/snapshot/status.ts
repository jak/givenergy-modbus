/**
 * Status group: operating status, faults, warnings and the inverter clock.
 * Single-phase reads IR 0, 14, 38–40, 47–49, 57 and HR 223/224; three-phase reads IR 1075–1077,
 * 1124 and 1300–1307. Both read the clock from HR 35–40.
 */
import type { InverterStatus, SinglePhaseStatus, ThreePhaseStatus } from '../model/snapshot.js';
import { toUint32 } from '../model/converters.js';
import { applyTimeFallback } from '../validation.js';
import { decodeBatteryWarnings, decodeInverterFaults, decodeThreePhaseFaults } from './faults.js';
import {
  readHolding,
  readInput,
  type BuildContext,
  type RegisterCaches,
  type SinglePhaseBuildContext,
  type ThreePhaseBuildContext,
} from './read.js';

const INVERTER_STATUS: readonly InverterStatus[] = ['waiting', 'normal', 'warning', 'fault', 'updating'];

const CHARGE_STATUS: Readonly<Record<number, NonNullable<SinglePhaseStatus['chargeStatus']>>> = {
  0: 'idle',
  2: 'charging',
  3: 'finishing',
  5: 'discharging',
};

/** About 100 years. Larger IR 47–48 values are garbage, as the external library also treats them. */
const MAX_HOURS_OF_OPERATION = 876_000;

function inverterStatus(value: number | undefined): InverterStatus {
  return (value !== undefined ? INVERTER_STATUS[value] : undefined) ?? 'unknown';
}

function hex4(value: number | undefined): string {
  return (value ?? 0).toString(16).padStart(4, '0');
}

export function buildStatus(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseStatus;
export function buildStatus(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseStatus;
export function buildStatus(registers: RegisterCaches, context: BuildContext): SinglePhaseStatus | ThreePhaseStatus;
export function buildStatus(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseStatus | ThreePhaseStatus {
  const hr = (address: number) => readHolding(registers, address) ?? 0;
  const ir = (address: number) => readInput(registers, address);

  // HR 35 holds the year as an offset from 2000.
  const systemTime = applyTimeFallback(
    2000 + hr(35), hr(36), hr(37), hr(38), hr(39), hr(40),
    context.previous?.status.systemTime ?? null,
  );

  if (context.layout === 'three_phase') {
    const faultWords = [1300, 1301, 1302, 1303, 1304, 1305, 1306, 1307].map(ir);
    return {
      inverterStatus: inverterStatus(ir(1076)),
      faults: decodeThreePhaseFaults(faultWords),
      systemTime,
      // GivTCP decodes IR 1075 as a boolean: any non-zero value is grid tied.
      systemMode: (ir(1075) ?? 0) !== 0 ? 'grid_tied' : 'offline',
      dcStatus: inverterStatus(ir(1124)),
      startDelayTime: ir(1077) ?? 0,
    };
  }

  const chargeStatusRaw = ir(14);
  const hoursHigh = ir(47);
  const hoursLow = ir(48);
  const hours = hoursHigh !== undefined && hoursLow !== undefined ? toUint32(hoursHigh, hoursLow) : undefined;
  return {
    inverterStatus: inverterStatus(ir(0)),
    faults: decodeInverterFaults(readHolding(registers, 223), readHolding(registers, 224)),
    systemTime,
    ...(chargeStatusRaw !== undefined
      ? { chargeStatus: CHARGE_STATUS[chargeStatusRaw] ?? 'unknown' }
      : {}),
    systemMode: ir(49) ?? 0,
    faultCode: hex4(ir(39)),
    warningCode: hex4(ir(40)),
    batteryWarnings: decodeBatteryWarnings(ir(57)),
    ...(hours !== undefined && hours <= MAX_HOURS_OF_OPERATION ? { hoursOfOperation: hours } : {}),
    countdownSeconds: ir(38) ?? 0,
  };
}
