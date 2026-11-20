/**
 * Battery modules and stacks.
 *
 * - Low-voltage modules: each BMS at 0x32–0x37, IR 60–115 (moved from 2.x
 *   `buildBatterySnapshot`, now with every field and signed temperatures).
 * - High-voltage stacks: each battery control unit (BCU) at 0x70 + n, and its modules (BMUs)
 *   at 0x50 + k (moved from 2.x `parseBcuData` / `buildBmuSnapshot`). 2.x copied the BCU's
 *   state of charge, voltage and cycle count onto every module; stack values now stay on
 *   `BatteryStack`.
 */
import type {
  BatteryStack,
  BatteryStackStatus,
  HighVoltageBatteryModule,
  LowVoltageBatteryModule,
} from '../model/snapshot.js';
import {
  registersToString,
  toCenti,
  toDeci,
  toDuint8,
  toInt16,
  toMilli,
  toSignedDeci,
  toUint32,
} from '../model/converters.js';
import { readHolding, type BuildContext, type RegisterCaches } from './read.js';

type Cache = Map<number, number>;

/** An empty LV slot can report −273.0 °C (research C). */
const EMPTY_SLOT_TEMPERATURE = -273;

function reader(cache: Cache) {
  const get = (address: number) => cache.get(address) ?? 0;
  return {
    get,
    uint32: (high: number) => toUint32(get(high), get(high + 1)),
    text: (start: number) =>
      registersToString([0, 1, 2, 3, 4].map((i) => get(start + i))).replace(/\0/g, '').trim(),
  };
}

/**
 * Whether an LV battery module slot holds a battery: it has a serial (IR 110–114 not all zero)
 * and none of its temperatures (IR 76–79, 81, 103, 104) reads −273.0 °C. Empty slots can still echo
 * the stack totals IR 105/106 (the AC capture's 0x34–0x36 do), so energy.ts uses this check too.
 */
export function isPresentModule(cache: Cache): boolean {
  const { get } = reader(cache);
  const hasSerial = [110, 111, 112, 113, 114].some((address) => get(address) !== 0);
  const emptyTemperature = [76, 77, 78, 79, 81, 103, 104].some((address) => cache.has(address) && toSignedDeci(get(address)) === EMPTY_SLOT_TEMPERATURE);
  return hasSerial && !emptyTemperature;
}

/**
 * IR 95 (average pack current) is only meaningful on Gen3 and AC inverters with ARM firmware
 * ≥ 214 and BMS firmware 3020–3999 or ≥ 4009 (research C); elsewhere it reports noise.
 */
function trustsModuleCurrent(context: BuildContext, armFirmwareVersion: number, bmsFirmwareVersion: number): boolean {
  if (context.model !== 'hybrid_gen3' && context.model !== 'ac') return false;
  if (armFirmwareVersion < 214) return false;
  return (bmsFirmwareVersion >= 3020 && bmsFirmwareVersion <= 3999) || bmsFirmwareVersion >= 4009;
}

function lowVoltageModule(cache: Cache, trustCurrent: (bms: number) => boolean): LowVoltageBatteryModule {
  const { get, uint32, text } = reader(cache);
  const firmwareVersion = get(98);
  const mosfetFlags = toDuint8(get(91))[0];
  const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
  return {
    kind: 'low_voltage',
    serialNumber: text(110),
    firmwareVersion,
    stateOfCharge: get(100),
    voltage: toMilli(get(80)),
    outputVoltage: toMilli(uint32(82)),
    ...(trustCurrent(firmwareVersion) ? { current: toCenti(toInt16(get(95))) } : {}),
    cycleCount: get(96),
    cellCount: get(97),
    cellVoltages: range(60, 16).map((address) => toMilli(get(address))),
    cellTemperatures: range(76, 4).map((address) => toSignedDeci(get(address))),
    temperatureMax: toSignedDeci(get(103)),
    temperatureMin: toSignedDeci(get(104)),
    mosfetTemperature: toSignedDeci(get(81)),
    // IR 91 high byte: bit 1 charge MOSFET, bit 2 discharge MOSFET (research C).
    chargeMosfetOn: (mosfetFlags & 0b010) !== 0,
    dischargeMosfetOn: (mosfetFlags & 0b100) !== 0,
    calibratedCapacityAh: toCenti(uint32(84)),
    designCapacityAh: toCenti(uint32(86)),
    remainingCapacityAh: toCenti(uint32(88)),
    designCapacity2Ah: toCenti(uint32(101)),
    statusBytes: [...toDuint8(get(90)), ...toDuint8(get(91)), ...toDuint8(get(92)), toDuint8(get(93))[0]],
    warningBytes: toDuint8(get(94)),
    forceDischargeFlag: get(107),
    dischargeTotalKwh: toDeci(get(105)),
    chargeTotalKwh: toDeci(get(106)),
  };
}

/** The LV modules present in `registers.batteryModules`, in address order. */
export function buildLowVoltageModules(registers: RegisterCaches, context: BuildContext): LowVoltageBatteryModule[] {
  const arm = readHolding(registers, 21) ?? 0;
  return (registers.batteryModules ?? [])
    .filter(isPresentModule)
    .map((cache) => lowVoltageModule(cache, (bms) => trustsModuleCurrent(context, arm, bms)));
}

const STACK_STATUS: readonly BatteryStackStatus[] = [
  'initialising', 'precharge', 'standby', 'charging', 'discharging', 'error', 'updating', 'off', 'production',
];

function batteryStack(cache: Cache, index: number): BatteryStack {
  const { get, uint32 } = reader(cache);
  const [stateOfChargeMax, stateOfChargeMin] = toDuint8(get(80));
  return {
    index,
    status: STACK_STATUS[get(70)] ?? 'unknown',
    moduleCount: get(64),
    cellsPerModule: get(65),
    cellVoltageCount: get(67),
    cellTemperatureCount: get(68),
    voltage: toDeci(get(73)),
    loadVoltage: toDeci(get(74)),
    current: toDeci(toInt16(get(76))),
    stateOfChargeMax,
    stateOfChargeMin,
    stateOfHealth: get(81),
    nominalCapacityAh: toDeci(get(98)),
    remainingCapacityAh: toDeci(get(99)),
    cycleCount: toDeci(get(100)),
    minimumDischargeVoltage: toDeci(get(102)),
    // IR 103 and IR 105 are limits (maximum values), not live readings, despite GivTCP's names.
    maximumChargeVoltage: toDeci(get(103)),
    minimumDischargeCurrent: toDeci(get(104)),
    maximumChargeCurrent: toDeci(get(105)),
    alarmWords: [114, 115, 116, 117, 118, 119].map(get),
    energy: {
      chargeTodayKwh: toDeci(uint32(90)),
      dischargeTodayKwh: toDeci(uint32(92)),
      chargeTotalKwh: toDeci(uint32(82)),
      dischargeTotalKwh: toDeci(uint32(84)),
    },
    capacity: {
      chargeTodayAh: uint32(94),
      dischargeTodayAh: uint32(96),
      chargeTotalAh: uint32(86),
      dischargeTotalAh: uint32(88),
    },
  };
}

/** Registers per module from a stack-wide count, falling back to `fallback` when unreadable. */
function perModule(total: number, moduleCount: number, fallback: number): number {
  return moduleCount > 0 && total > 0 && total % moduleCount === 0 ? total / moduleCount : fallback;
}

function highVoltageModule(cache: Cache, stack: number, index: number, cells: number, sensors: number): HighVoltageBatteryModule {
  const { get, text } = reader(cache);
  const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
  const cellTemperatures = range(90, sensors).map((address) => toSignedDeci(get(address)));
  return {
    kind: 'high_voltage',
    stack,
    index,
    serialNumber: text(114),
    cellVoltages: range(60, cells).map((address) => toMilli(get(address))),
    cellTemperatures,
    temperatureMax: Math.max(...cellTemperatures),
    temperatureMin: Math.min(...cellTemperatures),
  };
}

/** A BMU slot holds a module when its serial (IR 114–118) is not all zero, as in 2.x. */
function isPresentHighVoltageModule(cache: Cache): boolean {
  return [114, 115, 116, 117, 118].some((address) => (cache.get(address) ?? 0) !== 0);
}

/** HV stacks and their modules from `registers.batteryStacks`. */
export function buildBatteryStacks(registers: RegisterCaches): {
  stacks: BatteryStack[];
  modules: HighVoltageBatteryModule[];
} {
  const stacks: BatteryStack[] = [];
  const modules: HighVoltageBatteryModule[] = [];
  for (const { index: stackIndex, controlUnit, modules: moduleCaches } of registers.batteryStacks ?? []) {
    const stack = batteryStack(controlUnit, stackIndex);
    stacks.push(stack);
    const cells = perModule(stack.cellVoltageCount, stack.moduleCount, 24);
    const sensors = perModule(stack.cellTemperatureCount, stack.moduleCount, 24);
    for (const { index: moduleIndex, input } of moduleCaches) {
      if (isPresentHighVoltageModule(input)) {
        modules.push(highVoltageModule(input, stackIndex, moduleIndex, Math.min(cells, 24), Math.min(sensors, 24)));
      }
    }
  }
  return { stacks, modules };
}
