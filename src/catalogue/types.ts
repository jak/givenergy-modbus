import type { Capabilities } from '../model/capabilities.js';
import type { Layout } from '../model/models.js';

/** Fields shared by every setting in the catalogue. */
export interface SettingBase {
  /** Holding register. A number applies to every layout in `layouts`; an object gives per-layout addresses. */
  register: number | { readonly single_phase?: number; readonly three_phase?: number };
  /** Layouts this setting exists on when `register` is a number. Default: both. */
  layouts?: readonly Layout[];
  /** Name shown in the official GivEnergy app, when it has one. */
  appName?: string;
  /** One-line description for docs and JSDoc. */
  description: string;
  /**
   * Runtime gate on model/firmware. Settings with this are optional in the snapshot on every layout.
   * Receives the layout because some gates apply to one layout only (e.g. HR 313 is gated on single-phase,
   * while its three-phase twin HR 1110 is always present).
   */
  supported?: (capabilities: Capabilities, layout: Layout) => boolean;
  /** Read-only: shown in the snapshot, never written. */
  writable?: false;
  /** Writable only through unsafe_setSetting. `risk` is copied into its docs. */
  unsafe?: true;
  risk?: string;
}

/** On/off flag. Any non-zero raw value reads as `true`. */
export interface BooleanSetting extends SettingBase {
  kind: 'boolean';
}

/** Whole-number percentage, written only within `min`..`max`. */
export interface PercentSetting extends SettingBase {
  kind: 'percent';
  min: number;
  max: number;
}

/** Number stored as `value * scale`. `min`/`max` are in user units (after scaling). */
export interface IntegerSetting extends SettingBase {
  kind: 'integer';
  min: number;
  max: number;
  scale?: number;
  unit?: string;
}

/** Named values. Raw values without a name read as `'unknown'`. */
export interface EnumSetting extends SettingBase {
  kind: 'enum';
  values: Readonly<Record<string, number>>;
  /** Values that may be written, when only a subset is allowed (e.g. battery calibration). */
  writableValues?: readonly string[];
}

/** Time of day stored as an HHMM integer (e.g. 1730), exposed as `"HH:MM"`. */
export interface TimeSetting extends SettingBase {
  kind: 'time';
}

export type SettingDefinition = BooleanSetting | PercentSetting | IntegerSetting | EnumSetting | TimeSetting;

/** The decoded value type of a setting definition. */
export type ValueOf<D> =
  D extends { kind: 'boolean' } ? boolean :
  D extends { kind: 'percent' | 'integer' } ? number :
  D extends { kind: 'enum'; values: infer V } ? (keyof V & string) | 'unknown' :
  D extends { kind: 'time' } ? string : never;

/** The value type accepted when writing a setting definition. */
export type WriteValueOf<D> =
  D extends { kind: 'enum'; writableValues: readonly (infer W)[] } ? W :
  D extends { kind: 'enum'; values: infer V } ? keyof V & string :
  ValueOf<D>;

/** `true` when setting definition `D` exists on layout `L`. */
export type InLayout<D, L extends Layout> =
  D extends { register: number }
    ? D extends { layouts: readonly (infer X)[] } ? (L extends X ? true : false) : true
    : D extends { register: infer R } ? (L extends keyof R ? true : false) : false;
