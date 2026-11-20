/**
 * Register fixtures for the v3 snapshot builders.
 *
 * - `reference()` is the Gen3 Hybrid 5 kW reference unit (ARM/DSP 316) from
 *   test/fixtures/gen3-reference.json, with serials replaced by placeholders. Its values are
 *   documented in website/register-map.md sections 1–2.
 * - `capture(name)` is the inverter slave (0x11) of a wire capture in test/fixtures/captures/.
 *
 * `contextFor` resolves the model the way the library does: HR 0 and HR 21 on single-phase,
 * HR 0 and IR 1327 on three-phase (HR 21 reads 0 there).
 */
import { readFileSync } from 'node:fs';
import { capabilitiesFor } from '../../src/model/capabilities.js';
import { isPlantController, layoutOf, resolveModel } from '../../src/model/models.js';
import type {
  BuildContext,
  RegisterCaches,
  SinglePhaseBuildContext,
  ThreePhaseBuildContext,
} from '../../src/snapshot/read.js';
import { loadCapture } from './capture.js';

interface ReferenceFile {
  hr: Record<string, number>;
  ir: Record<string, number>;
  battery: Record<string, number>;
}

function toMap(record: Record<string, number>): Map<number, number> {
  return new Map(Object.entries(record).map(([address, value]) => [Number(address), value]));
}

/** The reference unit. Its one battery module (slave 0x32, IR 60–119) is `batteryModules[0]`. */
export function reference(): RegisterCaches & { batteryModules: Map<number, number>[] } {
  const file = JSON.parse(
    readFileSync(new URL('../fixtures/gen3-reference.json', import.meta.url), 'utf8'),
  ) as ReferenceFile;
  return { holding: toMap(file.hr), input: toMap(file.ir), batteryModules: [toMap(file.battery)] };
}

/**
 * The inverter slave's registers from a capture, with every battery module (0x32–0x37) and
 * battery control unit (0x70–0x77) the capture holds input registers for, in address order,
 * and every meter (0x01–0x08) it holds any registers for.
 * `inject` adds holding registers the capture lacks.
 */
export function capture(name: string, inject: Record<number, number> = {}): RegisterCaches {
  const plant = loadCapture(name);
  const { holding, input } = plant.slave(0x11);
  /** Each device in `from`–`to` the capture holds input registers for, with its address. */
  const inputsAt = (from: number, to: number) => {
    const caches: Array<{ address: number; input: Map<number, number> }> = [];
    for (let address = from; address <= to; address++) {
      const slave = plant.slaves.get(address);
      if (slave && slave.input.size > 0) caches.push({ address, input: new Map(slave.input) });
    }
    return caches;
  };
  const controlUnits = inputsAt(0x70, 0x77);
  // Every capture has at most one stack, whose modules are read from IR 60.
  if (controlUnits.length > 1) throw new Error(`${name}: more than one battery stack is not supported here`);
  const registers: RegisterCaches = {
    holding: new Map(holding),
    input: new Map(input),
    batteryModules: inputsAt(0x32, 0x37).map((device) => device.input),
    batteryStacks: controlUnits.map((controlUnit) => ({
      index: controlUnit.address - 0x70,
      controlUnit: controlUnit.input,
      modules: inputsAt(0x50, 0x5f).map((module) => ({ index: module.address - 0x50, input: module.input })),
    })),
    meters: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((slaveAddress) => {
      const slave = plant.slaves.get(slaveAddress);
      return slave ? [{ slaveAddress, input: new Map(slave.input), product: new Map(slave.meterProduct) }] : [];
    }),
  };
  for (const [address, value] of Object.entries(inject)) registers.holding.set(Number(address), value);
  return registers;
}

export function contextFor(registers: RegisterCaches): BuildContext {
  const deviceTypeCode = registers.holding.get(0) ?? 0;
  const singlePhaseArm = registers.holding.get(21) ?? 0;
  const model = resolveModel(deviceTypeCode, singlePhaseArm);
  if (model === 'unknown' || isPlantController(model)) throw new Error(`not an inverter: ${model}`);
  const layout = layoutOf(model);
  const arm = layout === 'three_phase' ? registers.input.get(1327) ?? 0 : singlePhaseArm;
  return { model, layout, capabilities: capabilitiesFor(model, arm) } as BuildContext;
}

export function singlePhaseContextFor(registers: RegisterCaches): SinglePhaseBuildContext {
  const context = contextFor(registers);
  if (context.layout !== 'single_phase') throw new Error(`expected single-phase, got ${context.model}`);
  return context;
}

export function threePhaseContextFor(registers: RegisterCaches): ThreePhaseBuildContext {
  const context = contextFor(registers);
  if (context.layout !== 'three_phase') throw new Error(`expected three-phase, got ${context.model}`);
  return context;
}

/** Registers built from plain objects, for quirk tests. */
export function registersOf(holding: Record<number, number>, input: Record<number, number> = {}): RegisterCaches {
  return {
    holding: new Map(Object.entries(holding).map(([a, v]) => [Number(a), v])),
    input: new Map(Object.entries(input).map(([a, v]) => [Number(a), v])),
  };
}

/** Every capture of an inverter, with the injection its NOTICE.md asks for. */
export const INVERTER_CAPTURES: Array<{ name: string; inject?: Record<number, number> }> = [
  { name: 'hybrid_gen1_arm449.log' },
  { name: 'hybrid_gen2_arm920.log' },
  { name: 'ac_arm282.log' },
  { name: 'all_in_one_arm620.log' },
  { name: 'hybrid_3ph.log' },
  // No HR 0–179 block in this capture: the device type code comes from the reporter's plant export.
  { name: 'hybrid_hv_gen3_arm295.log', inject: { 0: 0x8102, 21: 295 } },
];
