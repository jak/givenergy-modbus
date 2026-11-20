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
import { registersToString } from '../model/converters.js';

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
  /** Each high-voltage battery stack that answered, in address order (stack n at 0x70 + n). */
  batteryStacks?: BatteryStackCaches[];
}

/** Input registers of one high-voltage battery stack. */
export interface BatteryStackCaches {
  /** The battery control unit (BCU) at 0x70 + n, IR 60–119. */
  controlUnit: Map<number, number>;
  /**
   * Its battery modules (BMUs) at 0x50 + k, in address order. Stack n's registers are read at
   * IR 60 + 120 × n but stored here from IR 60, as the 2.x poll manager stores them.
   */
  modules: Map<number, number>[];
}

interface BuildContextBase {
  capabilities: Capabilities;
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
