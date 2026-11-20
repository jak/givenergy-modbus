import { expectTypeOf, test } from 'vitest';
import type { ValueOf, WriteValueOf, InLayout } from '../src/catalogue/types.js';

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
