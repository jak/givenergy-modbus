/**
 * Battery group: inverter-side battery values plus the modules and stacks. Single-phase reads
 * IR 50–59 and HR 29; three-phase reads IR 1120–1140. `battery.energy` is built by energy.ts,
 * so the return types leave it out.
 */
import type { SinglePhaseBattery, ThreePhaseBattery } from '../model/snapshot.js';
import { toCenti, toDeci, toInt16, toSignedDeci, toUint32 } from '../model/converters.js';
import { applyStateOfChargeFallback } from '../validation.js';
import { buildBatteryStacks, buildLowVoltageModules } from './battery-modules.js';
import {
  readHolding,
  readInput,
  type BuildContext,
  type RegisterCaches,
  type SinglePhaseBuildContext,
  type ThreePhaseBuildContext,
} from './read.js';

export type SinglePhaseBatteryWithoutEnergy = Omit<SinglePhaseBattery, 'energy'>;
export type ThreePhaseBatteryWithoutEnergy = Omit<ThreePhaseBattery, 'energy'>;

const PRIORITY: readonly ThreePhaseBattery['priority'][] = ['load', 'battery', 'grid'];

export function buildBattery(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseBatteryWithoutEnergy;
export function buildBattery(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseBatteryWithoutEnergy;
export function buildBattery(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseBatteryWithoutEnergy | ThreePhaseBatteryWithoutEnergy;
export function buildBattery(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseBatteryWithoutEnergy | ThreePhaseBatteryWithoutEnergy {
  const ir = (address: number) => readInput(registers, address) ?? 0;
  const previousStateOfCharge = context.previous?.battery.stateOfCharge ?? null;

  const highVoltage = context.capabilities.highVoltageBattery;
  const { stacks, modules: highVoltageModules } = buildBatteryStacks(registers);
  const group = highVoltage
    ? { modules: highVoltageModules, stacks }
    : { modules: buildLowVoltageModules(registers, context) };

  if (context.layout === 'three_phase') {
    return {
      // Discharge IR 1136–1137 minus charge IR 1138–1139, each uint32 ÷10.
      power: Math.round((toUint32(ir(1136), ir(1137)) - toUint32(ir(1138), ir(1139)))) / 10,
      voltage: toDeci(ir(1133)),
      current: toCenti(toInt16(ir(1140))),
      stateOfCharge: applyStateOfChargeFallback(ir(1132), previousStateOfCharge, false),
      // GivTCP decodes unknown priorities as load first.
      priority: PRIORITY[ir(1120)] ?? 'load',
      batteryManagementSystemVoltage: toDeci(ir(1131)),
      ...group,
    };
  }

  // HR 29 non-zero means a calibration is running, when 0 % is a real reading.
  const calibrating = (readHolding(registers, 29) ?? 0) !== 0;
  return {
    power: toInt16(ir(52)),
    voltage: toCenti(ir(50)),
    current: toCenti(toInt16(ir(51))),
    stateOfCharge: applyStateOfChargeFallback(ir(59), previousStateOfCharge, calibrating),
    temperature: toSignedDeci(ir(56)),
    chargerTemperature: toSignedDeci(ir(55)),
    ...group,
  };
}
