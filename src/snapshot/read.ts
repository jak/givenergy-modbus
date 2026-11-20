/**
 * Register access and shared types for the v3 snapshot builders.
 *
 * Each builder is a pure function of the register caches and a `BuildContext`. Readers return
 * `undefined` for a register that hasn't been read, so a builder can tell "unread" (leave the
 * field out) from "reads 0".
 */
import type { Capabilities } from '../model/capabilities.js';
import type { SinglePhaseModel, ThreePhaseModel } from '../model/models.js';
import type { InverterSnapshot } from '../model/snapshot.js';
import { registersToString, toDeci, toUint32 } from '../model/converters.js';

/** Register values, keyed by register number. */
export interface RegisterCaches {
  /** Holding registers of the inverter's main device address. */
  holding: Map<number, number>;
  /** Input registers of the inverter's main device address. */
  input: Map<number, number>;
  /**
   * Input registers of each low-voltage battery module (BMS at 0x32, 0x33, …), in address
   * order. Only modules that answered are listed.
   */
  batteryModules?: Map<number, number>[];
  /** Each high-voltage battery stack that answered, in address order. */
  batteryStacks?: BatteryStackCaches[];
  /** Each CT meter that answered (0x01–0x08), in address order. */
  meters?: MeterCaches[];
}

/** Registers of one CT meter. */
export interface MeterCaches {
  /** Device address, 1–8. */
  slaveAddress: number;
  /** Input registers IR 60–88 (function 4). */
  input: Map<number, number>;
  /**
   * Product registers (function 22); empty when the meter didn't answer them. The 2.x poll
   * reads 60–68, but only 60–66 are decoded (as in 2.x): 67–68 are not exposed.
   */
  product: Map<number, number>;
}

/**
 * Input registers of one high-voltage battery stack. Only devices that answered are listed, so
 * each carries its own index, taken from its device address rather than its list position.
 */
export interface BatteryStackCaches {
  /** Stack index: the battery control unit's device address − 0x70. */
  index: number;
  /** The battery control unit (BCU) at 0x70 + `index`, IR 60–119. */
  controlUnit: Map<number, number>;
  /** Its battery modules (BMUs) that answered, in address order. */
  modules: HighVoltageModuleCaches[];
}

/**
 * Input registers of one high-voltage battery module (BMU). Every stack's modules share the
 * device addresses 0x50 + k; stack n's are read at IR 60 + 120 × n but stored here from IR 60,
 * as the 2.x poll manager stores them.
 */
export interface HighVoltageModuleCaches {
  /** Module index within its stack: the device address − 0x50. */
  index: number;
  input: Map<number, number>;
}

interface BuildContextBase {
  capabilities: Capabilities;
  /**
   * ARM firmware version: HR 21 on single-phase, IR 1327 on three-phase (HR 21 reads 0 there).
   * Resolved once, with the model, by whoever builds the context.
   */
  armFirmwareVersion: number;
  /** The previous snapshot, for fallbacks such as an invalid clock. */
  previous?: InverterSnapshot | null;
}

export interface SinglePhaseBuildContext extends BuildContextBase {
  model: SinglePhaseModel;
  layout: 'single_phase';
}

export interface ThreePhaseBuildContext extends BuildContextBase {
  model: ThreePhaseModel;
  layout: 'three_phase';
}

/** What a builder knows about the inverter besides its registers. Discriminated on `layout`. */
export type BuildContext = SinglePhaseBuildContext | ThreePhaseBuildContext;

/** A group builder with one overload per layout. */
export interface LayoutBuilder<SinglePhaseResult, ThreePhaseResult> {
  (registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseResult;
  (registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseResult;
}

/**
 * Call a layout builder with a context whose layout isn't known statically. The builders have
 * no overload for the `BuildContext` union, so this narrows the context first.
 */
export function buildForLayout<SinglePhaseResult, ThreePhaseResult>(
  build: LayoutBuilder<SinglePhaseResult, ThreePhaseResult>,
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseResult | ThreePhaseResult {
  return context.layout === 'three_phase' ? build(registers, context) : build(registers, context);
}

export function readHolding(registers: RegisterCaches, address: number): number | undefined {
  return registers.holding.get(address);
}

export function readInput(registers: RegisterCaches, address: number): number | undefined {
  return registers.input.get(address);
}

/**
 * ASCII text from consecutive registers, two characters per register (high byte first), with
 * NUL and space padding removed. `undefined` when none of the registers has been read.
 */
export function readText(table: Map<number, number>, start: number, count: number): string | undefined {
  const values: number[] = [];
  let anyRead = false;
  for (let address = start; address < start + count; address++) {
    const value = table.get(address);
    if (value !== undefined) anyRead = true;
    values.push(value ?? 0);
  }
  if (!anyRead) return undefined;
  return registersToString(values).replace(/\0/g, '').trim();
}

/**
 * Readers over one register table that treat an unread register as 0. For values that are
 * always present in the snapshot; use `readHolding`/`readInput` where unread must stay absent.
 */
export function zeroFilledReader(table: Map<number, number>) {
  const get = (address: number) => table.get(address) ?? 0;
  const uint32 = (high: number) => toUint32(get(high), get(high + 1));
  return {
    get,
    /** Two registers, high word first, as an unsigned 32-bit value. */
    uint32,
    /** `uint32` ÷10, the scaling of most energy and three-phase power counters. */
    deciUint32: (high: number) => toDeci(uint32(high)),
    /** ASCII text as `readText`, but `''` rather than `undefined` when nothing was read. */
    text: (start: number, count: number) => readText(table, start, count) ?? '',
  };
}

/** The `count` consecutive register addresses from `from`. */
export function range(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

/** Round to one decimal place, for sums of ÷10 values. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Round to two decimal places, dropping float error from adding ÷10 values. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
