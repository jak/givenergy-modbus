import { expectTypeOf, test } from 'vitest';
import type { ValueOf, WriteValueOf, InLayout } from '../src/catalogue/types.js';
import type {
  SettingKey,
  Settings,
  SettingWriteValue,
  UnsafeSettingKey,
  WritableSettingKey,
} from '../src/catalogue/index.js';

const sample = {
  flag: { register: 27, kind: 'boolean', description: 'x' },
  split: { register: { single_phase: 110, three_phase: 1109 }, kind: 'percent', min: 4, max: 100, description: 'x' },
  singlePhaseOnly: { register: 104, layouts: ['single_phase'], kind: 'boolean', description: 'x' },
  calibration: {
    register: 29,
    kind: 'enum',
    values: { stop: 0, start: 1, charge: 3, finish: 7 },
    writableValues: ['stop', 'start'],
    description: 'x',
  },
  mode: { register: 50, kind: 'enum', values: { off: 0, on: 1 }, description: 'x' },
  scaled: { register: 51, kind: 'integer', min: 0, max: 500, scale: 10, description: 'x' },
  start: { register: 94, kind: 'time', description: 'x' },
} as const;

test('value types follow kind', () => {
  expectTypeOf<ValueOf<typeof sample.flag>>().toEqualTypeOf<boolean>();
  expectTypeOf<ValueOf<typeof sample.split>>().toEqualTypeOf<number>();
  expectTypeOf<ValueOf<typeof sample.scaled>>().toEqualTypeOf<number>();
  expectTypeOf<ValueOf<typeof sample.start>>().toEqualTypeOf<string>();
  // Decoded enums can always be 'unknown' because the inverter may report a value we have no name for.
  expectTypeOf<ValueOf<typeof sample.calibration>>().toEqualTypeOf<'stop' | 'start' | 'charge' | 'finish' | 'unknown'>();
});

test('write types narrow to writable enum values and never include unknown', () => {
  expectTypeOf<WriteValueOf<typeof sample.calibration>>().toEqualTypeOf<'stop' | 'start'>();
  expectTypeOf<WriteValueOf<typeof sample.mode>>().toEqualTypeOf<'off' | 'on'>();
  expectTypeOf<WriteValueOf<typeof sample.flag>>().toEqualTypeOf<boolean>();
});

test('layouts follow the register shape', () => {
  expectTypeOf<InLayout<typeof sample.split, 'three_phase'>>().toEqualTypeOf<true>();
  expectTypeOf<InLayout<typeof sample.split, 'single_phase'>>().toEqualTypeOf<true>();
  expectTypeOf<InLayout<typeof sample.singlePhaseOnly, 'three_phase'>>().toEqualTypeOf<false>();
  expectTypeOf<InLayout<typeof sample.singlePhaseOnly, 'single_phase'>>().toEqualTypeOf<true>();
  // A plain numeric register with no `layouts` applies to both layouts.
  expectTypeOf<InLayout<typeof sample.flag, 'three_phase'>>().toEqualTypeOf<true>();
});

test('a per-layout register missing a layout excludes it', () => {
  const threePhaseOnly = { register: { three_phase: 1110 }, kind: 'boolean', description: 'x' } as const;
  expectTypeOf<InLayout<typeof threePhaseOnly, 'single_phase'>>().toEqualTypeOf<false>();
  expectTypeOf<InLayout<typeof threePhaseOnly, 'three_phase'>>().toEqualTypeOf<true>();
});

test('setting keys follow the layout', () => {
  expectTypeOf<'forceCharge'>().not.toExtend<SettingKey<'single_phase'>>();
  expectTypeOf<'forceCharge'>().toExtend<SettingKey<'three_phase'>>();
  expectTypeOf<'batteryChargeRate'>().not.toExtend<SettingKey<'three_phase'>>();
  expectTypeOf<'batteryReserve'>().toExtend<SettingKey<'single_phase'> & SettingKey<'three_phase'>>();
});

test('unsafe and read-only settings are not writable through setSetting', () => {
  expectTypeOf<'forceOffGrid'>().toExtend<UnsafeSettingKey<'single_phase'>>();
  expectTypeOf<'forceOffGrid'>().not.toExtend<WritableSettingKey<'single_phase'>>();
  expectTypeOf<'exportLimit'>().not.toExtend<WritableSettingKey<'single_phase'>>();
  expectTypeOf<'exportLimit'>().not.toExtend<UnsafeSettingKey<'single_phase'>>();
  expectTypeOf<'threePhaseExportLimit'>().not.toExtend<WritableSettingKey<'three_phase'>>();
  expectTypeOf<'ecoMode'>().toExtend<WritableSettingKey<'single_phase'>>();
});

test('gated settings are optional in the snapshot', () => {
  // An empty object satisfies the property only when it is optional.
  expectTypeOf<{}>().toExtend<Pick<Settings<'single_phase'>, 'exportPriority'>>();
  expectTypeOf<{}>().not.toExtend<Pick<Settings<'single_phase'>, 'ecoMode'>>();
  expectTypeOf<Settings<'single_phase'>['exportPriority']>().toEqualTypeOf<
    'loadFirst' | 'batteryFirst' | 'gridFirst' | 'unknown' | undefined
  >();
  // HR 313 is gated on single-phase only, but `supported` exists on the entry, so it is optional on both layouts.
  expectTypeOf<Settings<'three_phase'>['inverterChargePowerPercent']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<Settings<'single_phase'>['ecoMode']>().toEqualTypeOf<boolean>();
  expectTypeOf<Settings<'single_phase'>>().not.toHaveProperty('forceCharge');
});

test('battery calibration writes only off, discharge and charge', () => {
  expectTypeOf<SettingWriteValue<'batteryCalibration'>>().toEqualTypeOf<'off' | 'discharge' | 'charge'>();
});
