/**
 * Settings group, built generically from the catalogue: every setting that exists on the layout,
 * passes its capability gate and whose holding register has been read. Anything else is absent
 * (not `undefined`-valued), so `'exportPriority' in settings` says whether the inverter has it.
 */
import { isSupported, registerFor, SETTINGS, type Settings } from '../catalogue/index.js';
import { decodeSetting } from '../catalogue/codec.js';
import type { SettingDefinition } from '../catalogue/types.js';
import {
  readHolding,
  type BuildContext,
  type RegisterCaches,
  type SinglePhaseBuildContext,
  type ThreePhaseBuildContext,
} from './read.js';

export function buildSettings(registers: RegisterCaches, context: SinglePhaseBuildContext): Settings<'single_phase'>;
export function buildSettings(registers: RegisterCaches, context: ThreePhaseBuildContext): Settings<'three_phase'>;
export function buildSettings(
  registers: RegisterCaches,
  context: BuildContext,
): Settings<'single_phase'> | Settings<'three_phase'> {
  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]) {
    if (!isSupported(key, context.layout, context.capabilities)) continue;
    const register = registerFor(key, context.layout);
    const raw = register === undefined ? undefined : readHolding(registers, register);
    if (raw === undefined) continue;
    const definition: SettingDefinition = SETTINGS[key];
    settings[key] = decodeSetting(definition, raw);
  }
  // Keys and value types follow the catalogue by construction; the type tests check Settings<L>.
  return settings as Settings<'single_phase'> | Settings<'three_phase'>;
}
