/**
 * Energy counters for every group: solar, grid, inverter, load (consumption) and battery.
 * Single-phase reads IR 6–46 and IR 180–183 plus the battery module and battery control unit
 * caches; three-phase reads IR 1360–1413 (each uint32 ÷10).
 *
 * The result holds only the energy fields; `power.ts` builds the rest of each group.
 */
import type { BatteryEnergy, GridEnergy, InverterEnergy } from '../model/snapshot.js';
import { toDeci, toUint32 } from '../model/converters.js';
import {
  readInput,
  type BuildContext,
  type RegisterCaches,
  type SinglePhaseBuildContext,
  type ThreePhaseBuildContext,
} from './read.js';
import { isPresentModule } from './battery-modules.js';

interface LoadEnergy {
  energyTodayKwh: number;
  energyTotalKwh: number;
}

interface SolarEnergy {
  energyTodayKwh: number;
  energyTotalKwh: number;
}

export interface SinglePhaseEnergy {
  solar: SolarEnergy & { diverterEnergyKwh: number };
  grid: GridEnergy;
  inverter: InverterEnergy;
  load: LoadEnergy;
  battery: BatteryEnergy;
}

export interface ThreePhaseEnergy {
  solar: SolarEnergy;
  grid: GridEnergy;
  inverter: InverterEnergy;
  load: LoadEnergy;
  battery: BatteryEnergy;
}

/** Round to 0.01 kWh, dropping float error from adding ÷10 values. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function deciUint32(cache: Map<number, number>, high: number): number {
  return toDeci(toUint32(cache.get(high) ?? 0, cache.get(high + 1) ?? 0));
}

interface Totals {
  charge: number;
  discharge: number;
}

/**
 * Lifetime battery charge/discharge, kWh: the first source that isn't 0 for both.
 *
 * 1. High-voltage stacks, summed (each battery control unit is its own pack): IR 82–83 charge,
 *    IR 84–85 discharge, uint32 ÷10.
 * 2. The first low-voltage battery module with a serial: IR 106 charge, IR 105 discharge, ÷10.
 *    These are stack totals that every pack repeats, so they are not summed. They wrap at 6553.5.
 * 3. Inverter IR 181 charge, IR 180 discharge, ÷10 (Gen1; read 0 on Gen2).
 *
 * `undefined` when every source reads 0 or is missing. Not used, although 2.x read them:
 * HR 4109–4112 are write-only seed registers, not live totals; HR 180 is not a battery total
 * (it reads 0x5858 on the reference Gen3); and IR 27–28 is the AC charge total.
 */
function batteryTotals(registers: RegisterCaches): Totals | undefined {
  const ir = (address: number) => readInput(registers, address) ?? 0;
  const candidates: Array<() => Totals | undefined> = [
    () => {
      const stacks = registers.batteryStacks ?? [];
      if (stacks.length === 0) return undefined;
      return {
        charge: round2(stacks.reduce((sum, stack) => sum + deciUint32(stack.controlUnit, 82), 0)),
        discharge: round2(stacks.reduce((sum, stack) => sum + deciUint32(stack.controlUnit, 84), 0)),
      };
    },
    () => {
      const module = (registers.batteryModules ?? []).find(isPresentModule);
      if (!module) return undefined;
      return { charge: toDeci(module.get(106) ?? 0), discharge: toDeci(module.get(105) ?? 0) };
    },
    () => ({ charge: toDeci(ir(181)), discharge: toDeci(ir(180)) }),
  ];
  for (const candidate of candidates) {
    const totals = candidate();
    if (totals && (totals.charge !== 0 || totals.discharge !== 0)) return totals;
  }
  return undefined;
}

export function buildEnergy(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseEnergy;
export function buildEnergy(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseEnergy;
export function buildEnergy(registers: RegisterCaches, context: BuildContext): SinglePhaseEnergy | ThreePhaseEnergy;
export function buildEnergy(registers: RegisterCaches, context: BuildContext): SinglePhaseEnergy | ThreePhaseEnergy {
  const ir = (address: number) => readInput(registers, address) ?? 0;
  const deci = (address: number) => toDeci(ir(address));
  const counter = (high: number) => deciUint32(registers.input, high);

  if (context.layout === 'three_phase') {
    return {
      solar: { energyTodayKwh: counter(1412), energyTotalKwh: counter(1374) },
      grid: {
        importTodayKwh: counter(1380),
        importTotalKwh: counter(1382),
        exportTodayKwh: counter(1384),
        exportTotalKwh: counter(1386),
      },
      inverter: {
        outputTodayKwh: counter(1360),
        outputTotalKwh: counter(1362),
        acChargeTodayKwh: counter(1376),
        acChargeTotalKwh: counter(1378),
      },
      load: { energyTodayKwh: counter(1396), energyTotalKwh: counter(1398) },
      battery: {
        chargeTodayKwh: counter(1392),
        dischargeTodayKwh: counter(1388),
        chargeTotalKwh: counter(1394),
        dischargeTotalKwh: counter(1390),
      },
    };
  }

  const grid: GridEnergy = {
    importTodayKwh: deci(26),
    exportTodayKwh: deci(25),
    importTotalKwh: counter(32),
    exportTotalKwh: counter(21),
  };
  const inverter: InverterEnergy = {
    acChargeTodayKwh: deci(35),
    acChargeTotalKwh: counter(27),
    outputTodayKwh: deci(44),
    outputTotalKwh: counter(45),
  };
  // The app's consumption: grid import − grid export + inverter output − AC charge
  // (website/register-map.md section 2). Clamped at 0, as 2.x did.
  const consumption = (imported: number, exported: number, output: number, acCharge: number) =>
    Math.max(0, round2(imported - exported + output - acCharge));
  // Gen1 keeps its battery today counters in IR 182/183; IR 36/37 elsewhere (research C; the
  // external library's VALUE_SOURCES).
  const gen1 = context.model === 'hybrid_gen1';
  const totals = batteryTotals(registers);

  return {
    solar: {
      energyTodayKwh: round2(deci(17) + deci(19)),
      energyTotalKwh: counter(11),
      diverterEnergyKwh: deci(23),
    },
    grid,
    inverter,
    load: {
      energyTodayKwh: consumption(grid.importTodayKwh, grid.exportTodayKwh, inverter.outputTodayKwh, inverter.acChargeTodayKwh),
      energyTotalKwh: consumption(grid.importTotalKwh, grid.exportTotalKwh, inverter.outputTotalKwh, inverter.acChargeTotalKwh),
    },
    battery: {
      chargeTodayKwh: deci(gen1 ? 183 : 36),
      dischargeTodayKwh: deci(gen1 ? 182 : 37),
      ...(totals ? { chargeTotalKwh: totals.charge, dischargeTotalKwh: totals.discharge } : {}),
      throughputTotalKwh: counter(6),
    },
  };
}
