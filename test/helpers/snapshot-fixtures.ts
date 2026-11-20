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

export function reference(): RegisterCaches & { battery: Map<number, number> } {
  const file = JSON.parse(
    readFileSync(new URL('../fixtures/gen3-reference.json', import.meta.url), 'utf8'),
  ) as ReferenceFile;
  return { holding: toMap(file.hr), input: toMap(file.ir), battery: toMap(file.battery) };
}

/** The inverter slave's registers from a capture. `inject` adds holding registers the capture lacks. */
export function capture(name: string, inject: Record<number, number> = {}): RegisterCaches {
  const { holding, input } = loadCapture(name).slave(0x11);
  const registers = { holding: new Map(holding), input: new Map(input) };
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
