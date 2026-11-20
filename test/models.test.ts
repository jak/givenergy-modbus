import { describe, it, expect } from 'vitest';
import {
  resolveModel,
  layoutOf,
  isPlantController,
  hasHighVoltageBattery,
} from '../src/model/models.js';

describe('resolveModel', () => {
  // HR 0 = device type code, HR 21 = ARM firmware (research R-A)
  const cases: Array<[code: number, arm: number, model: string]> = [
    [0x2001, 316, 'hybrid_gen3'], // reference unit: century 3
    [0x2001, 302, 'hybrid_gen3'],
    [0x2003, 920, 'hybrid_gen2'], // century 9
    [0x2003, 820, 'hybrid_gen2'],
    [0x2001, 449, 'hybrid_gen1'], // Gen1 lines are 1xx, 2xx, 4xx
    [0x2003, 187, 'hybrid_gen1'],
    [0x2101, 0, 'polar'],
    [0x2201, 0, 'hybrid_gen3_plus'],
    [0x2301, 0, 'pv'],
    [0x2401, 0, 'hybrid_gen3'], // unknown 24xx/25xx: Gen3 layout, no extras
    [0x3001, 282, 'ac'],
    [0x4004, 0, 'hybrid_3ph'],
    [0x4101, 0, 'all_in_one_commercial'],
    [0x5001, 1036, 'ems'],
    [0x6001, 0, 'ac_3ph'],
    [0x7001, 0, 'gateway'],
    [0x8001, 620, 'all_in_one'],
    [0x8102, 295, 'hybrid_hv_gen3'],
    [0x8201, 0, 'all_in_one_hybrid'],
    [0x8301, 0, 'hybrid_gen4'],
  ];

  it.each(cases.map(([code, arm, model]) => ({
    hex: `0x${code.toString(16).padStart(4, '0')}`,
    code,
    arm,
    model,
  })))('HR0=$hex ARM $arm → $model', ({ code, arm, model }) => {
    expect(resolveModel(code, arm)).toBe(model);
  });

  it('treats All in One Hybrid (82xx) as single-phase, as GivTCP does, although the Python library says three-phase', () => {
    expect(layoutOf('all_in_one_hybrid')).toBe('single_phase');
  });

  it('puts three-phase models on the three-phase register layout', () => {
    expect(layoutOf('hybrid_3ph')).toBe('three_phase');
    expect(layoutOf('ac_3ph')).toBe('three_phase');
    expect(layoutOf('all_in_one_commercial')).toBe('three_phase');
  });

  it('flags EMS and Gateway as plant controllers, which this library refuses', () => {
    expect(isPlantController('ems')).toBe(true);
    expect(isPlantController('gateway')).toBe(true);
    expect(isPlantController('hybrid_gen3')).toBe(false);
  });

  it('returns unknown for an unrecognised code instead of guessing Gen2 (2.x behaviour)', () => {
    expect(resolveModel(0x9001, 0)).toBe('unknown');
  });
});

describe('hasHighVoltageBattery', () => {
  it('is true for models with a high-voltage stack (battery control unit at 0x70+, modules at 0x50+)', () => {
    for (const model of ['all_in_one', 'all_in_one_hybrid', 'hybrid_hv_gen3', 'hybrid_3ph', 'ac_3ph', 'all_in_one_commercial'] as const) {
      expect(hasHighVoltageBattery(model), model).toBe(true);
    }
  });

  it('is false for low-voltage models, which do not have a battery control unit', () => {
    for (const model of ['hybrid_gen1', 'hybrid_gen2', 'hybrid_gen3', 'hybrid_gen3_plus', 'hybrid_gen4', 'ac', 'polar', 'pv'] as const) {
      expect(hasHighVoltageBattery(model), model).toBe(false);
    }
  });
});
