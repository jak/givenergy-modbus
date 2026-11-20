import { SETTINGS } from './settings.js';
import type { InLayout, SettingDefinition, ValueOf, WriteValueOf } from './types.js';
import type { Capabilities } from '../model/capabilities.js';
import type { Layout } from '../model/models.js';

type Catalogue = typeof SETTINGS;

/** Keys of the settings that exist on layout `L`. */
export type SettingKey<L extends Layout> = {
  [K in keyof Catalogue]: InLayout<Catalogue[K], L> extends true ? K : never;
}[keyof Catalogue];

type GatedKey<L extends Layout> = {
  [K in SettingKey<L>]: Catalogue[K] extends { supported: unknown } ? K : never;
}[SettingKey<L>];

/** The snapshot's `settings` group for layout `L`. Gated settings are optional. */
export type Settings<L extends Layout> = {
  [K in Exclude<SettingKey<L>, GatedKey<L>>]: ValueOf<Catalogue[K]>;
} & {
  [K in GatedKey<L>]?: ValueOf<Catalogue[K]>;
};

/** Keys `setSetting` accepts on layout `L`: excludes read-only and unsafe settings. */
export type WritableSettingKey<L extends Layout> = {
  [K in SettingKey<L>]: Catalogue[K] extends { writable: false } | { unsafe: true } ? never : K;
}[SettingKey<L>];

/** Keys only `unsafe_setSetting` accepts on layout `L`. */
export type UnsafeSettingKey<L extends Layout> = {
  [K in SettingKey<L>]: Catalogue[K] extends { unsafe: true } ? K : never;
}[SettingKey<L>];

/** The value type accepted when writing setting `K`. */
export type SettingWriteValue<K extends keyof Catalogue> = WriteValueOf<Catalogue[K]>;

export type SinglePhaseSettings = Settings<'single_phase'>;
export type ThreePhaseSettings = Settings<'three_phase'>;

/** The holding register for `key` on `layout`, or `undefined` when the setting does not exist there. */
export function registerFor(key: keyof Catalogue, layout: Layout): number | undefined {
  const definition: SettingDefinition = SETTINGS[key];
  const { register } = definition;
  if (typeof register === 'number') {
    return !definition.layouts || definition.layouts.includes(layout) ? register : undefined;
  }
  return register[layout];
}

/** Whether `key` exists on `layout` and passes its model/firmware gate. */
export function isSupported(key: keyof Catalogue, layout: Layout, capabilities: Capabilities): boolean {
  if (registerFor(key, layout) === undefined) return false;
  const definition: SettingDefinition = SETTINGS[key];
  return definition.supported?.(capabilities, layout) ?? true;
}

export { SETTINGS };
export type * from './types.js';
