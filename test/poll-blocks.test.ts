import { describe, expect, it } from 'vitest';
import { SETTINGS, isSupported, registerFor } from '../src/catalogue/index.js';
import { capabilitiesFor, type Capabilities } from '../src/model/capabilities.js';
import type { InverterModel, Layout } from '../src/model/models.js';
import {
  blockCovers,
  effectiveCapabilities,
  holdingBlocksFor,
  inputBlocksFor,
  type RegisterBlock,
} from '../src/poll-blocks.js';
import { buildSnapshot } from '../src/snapshot/index.js';
import type { BuildContext, RegisterCaches } from '../src/snapshot/read.js';
import { capture, contextFor, INVERTER_CAPTURES, reference } from './helpers/snapshot-fixtures.js';

const none: Capabilities = {
  tenSlots: false,
  perSlotTargets: false,
  pauseMode: false,
  pauseWindow: false,
  acSettingsBlock: false,
  highVoltageBattery: false,
  smartLoad: false,
};
const all: Capabilities = {
  tenSlots: true,
  perSlotTargets: true,
  pauseMode: true,
  pauseWindow: true,
  acSettingsBlock: true,
  highVoltageBattery: true,
  smartLoad: true,
};

const MODELS: Record<Layout, InverterModel[]> = {
  single_phase: [
    'hybrid_gen1', 'hybrid_gen2', 'hybrid_gen3', 'hybrid_gen3_plus', 'hybrid_gen4', 'hybrid_hv_gen3',
    'polar', 'pv', 'ac', 'all_in_one', 'all_in_one_hybrid',
  ],
  three_phase: ['hybrid_3ph', 'ac_3ph', 'all_in_one_commercial'],
};

/**
 * Every distinct capability set a model can have on `layout`: each model at firmware either side
 * of each threshold, as resolved and after each runtime downgrade.
 */
function reachableCapabilities(layout: Layout): Array<[string, Capabilities]> {
  const seen = new Map<string, [string, Capabilities]>();
  const downgrades: number[][] = [[], [240], [300], [240, 300]];
  for (const model of MODELS[layout]) {
    for (const arm of [0, 186, 187, 199, 200, 302, 303, 999]) {
      for (const unanswered of downgrades) {
        const capabilities = effectiveCapabilities(capabilitiesFor(model, arm), new Set(unanswered));
        const name = `${model} ARM ${arm}${unanswered.length ? ` without HR ${unanswered.join('/')}` : ''}`;
        const key = JSON.stringify(capabilities);
        if (!seen.has(key)) seen.set(key, [name, capabilities]);
      }
    }
  }
  return [...seen.values()];
}

const bases = (blocks: RegisterBlock[]) => blocks.map((block) => block.base);
const inBlocks = (blocks: RegisterBlock[], register: number) => blocks.some((block) => blockCovers(block, register));

describe('holdingBlocksFor', () => {
  describe('single-phase', () => {
    it('reads only HR 0 between full refreshes', () => {
      expect(holdingBlocksFor('single_phase', all, false)).toEqual([{ base: 0, count: 60 }]);
    });

    it('adds HR 60, 120 and 180 on a full refresh (HR 180 only for HR 199, inverter parallel mode)', () => {
      expect(bases(holdingBlocksFor('single_phase', none, true))).toEqual([0, 60, 120, 180]);
    });

    it('adds HR 240 with ten slots and HR 300 with the AC settings block', () => {
      expect(bases(holdingBlocksFor('single_phase', { ...none, tenSlots: true }, true))).toEqual([0, 60, 120, 180, 240]);
      expect(bases(holdingBlocksFor('single_phase', { ...none, acSettingsBlock: true }, true))).toEqual([0, 60, 120, 180, 300]);
    });

    it('reads every block 60 registers wide', () => {
      for (const block of holdingBlocksFor('single_phase', all, true)) expect(block.count).toBe(60);
    });

    it('quirk: reads HR 318 on its own without the HR 300 block, like GivTCP modbus_patches EXTRA_READS', () => {
      // GivTCP modbus_patches.py EXTRA_READS does the same extra read on Gen1, Gen2 and HV Gen3.
      const pauseWithWindow = { ...none, pauseMode: true, pauseWindow: true };
      expect(holdingBlocksFor('single_phase', pauseWithWindow, true)).toContainEqual({ base: 318, count: 3 });
      // Gen1 rejects any read touching HR 319/320, so it gets HR 318 alone.
      expect(holdingBlocksFor('single_phase', { ...none, pauseMode: true }, true)).toContainEqual({ base: 318, count: 1 });
      // The HR 300 block already covers them.
      expect(bases(holdingBlocksFor('single_phase', { ...pauseWithWindow, acSettingsBlock: true }, true))).not.toContain(318);
      expect(bases(holdingBlocksFor('single_phase', pauseWithWindow, false))).toEqual([0]);
    });
  });

  describe('three-phase', () => {
    it('reads HR 0, 1000, 1060 and five registers from 1120 between full refreshes', () => {
      expect(holdingBlocksFor('three_phase', all, false)).toEqual([
        { base: 0, count: 60 },
        { base: 1000, count: 60 },
        { base: 1060, count: 60 },
        { base: 1120, count: 5 },
      ]);
    });

    it('adds HR 60, 120 and 240 on a full refresh, whatever the capabilities say', () => {
      // Three-phase slots 3–10 live in HR 246–299, as on single-phase. HR 300 is single-phase only.
      expect(bases(holdingBlocksFor('three_phase', none, true))).toEqual([0, 60, 120, 240, 1000, 1060, 1120]);
      expect(bases(holdingBlocksFor('three_phase', all, true))).toEqual([0, 60, 120, 240, 1000, 1060, 1120]);
    });
  });

  it('never reads HR 4080 (2.x read its 32-bit battery totals there; they are write-only seeds)', () => {
    for (const layout of ['single_phase', 'three_phase'] as const) {
      expect(inBlocks(holdingBlocksFor(layout, all, true), 4080)).toBe(false);
    }
  });

  it('reads every holding block of the fast poll on a full refresh too', () => {
    for (const layout of ['single_phase', 'three_phase'] as const) {
      const full = holdingBlocksFor(layout, all, true);
      for (const block of holdingBlocksFor(layout, all, false)) expect(full).toContainEqual(block);
    }
  });
});

describe('inputBlocksFor', () => {
  it('reads IR 0 and 180 on single-phase, and IR 240 (combined generation power) on a full refresh only', () => {
    // 2.x never read IR 240. IR 247/248 hold the combined generation power (research C); it is
    // polled only on a full refresh so a device that doesn't answer it costs at most three slow polls.
    expect(inputBlocksFor('single_phase', false)).toEqual([{ base: 0, count: 60 }, { base: 180, count: 60 }]);
    expect(inputBlocksFor('single_phase', true)).toEqual([
      { base: 0, count: 60 },
      { base: 180, count: 60 },
      { base: 240, count: 60 },
    ]);
  });

  it('reads IR 0, 180 and 1000–1419 on three-phase', () => {
    for (const full of [false, true]) {
      expect(bases(inputBlocksFor('three_phase', full))).toEqual([0, 180, 1000, 1060, 1120, 1180, 1240, 1300, 1360]);
      for (const block of inputBlocksFor('three_phase', full)) expect(block.count).toBe(60);
    }
  });
});

describe('blockCovers', () => {
  it('covers its base up to, but not including, base + count', () => {
    expect(blockCovers({ base: 1120, count: 5 }, 1120)).toBe(true);
    expect(blockCovers({ base: 1120, count: 5 }, 1124)).toBe(true);
    expect(blockCovers({ base: 1120, count: 5 }, 1125)).toBe(false);
    expect(blockCovers({ base: 1120, count: 5 }, 1119)).toBe(false);
  });
});

describe('effectiveCapabilities', () => {
  const gen3 = capabilitiesFor('hybrid_gen3', 316);

  it('keeps the resolved capabilities while every block answers', () => {
    expect(effectiveCapabilities(gen3, new Set())).toEqual(gen3);
  });

  it('turns ten slots and per-slot targets off when HR 240 goes unanswered', () => {
    // The targets live in HR 240–299 too (slot 1's at HR 242), so they go with the slots.
    expect(effectiveCapabilities(gen3, new Set([240]))).toEqual({ ...gen3, tenSlots: false, perSlotTargets: false });
  });

  it('turns the AC settings block off when HR 300 goes unanswered', () => {
    expect(effectiveCapabilities(gen3, new Set([300]))).toEqual({ ...gen3, acSettingsBlock: false });
  });

  it('does not change the input it was given', () => {
    const copy = { ...gen3 };
    effectiveCapabilities(gen3, new Set([240, 300]));
    expect(gen3).toEqual(copy);
  });
});

describe('every catalogue register is in a full-refresh block', () => {
  const layouts: Layout[] = ['single_phase', 'three_phase'];
  const keys = Object.keys(SETTINGS) as (keyof typeof SETTINGS)[];
  describe.each(layouts)('%s', (layout) => {
    it.each(reachableCapabilities(layout))('%s', (_name, capabilities) => {
      const blocks = holdingBlocksFor(layout, capabilities, true);
      const outside = keys.filter((key) => {
        const register = registerFor(key, layout);
        return register !== undefined && isSupported(key, layout, capabilities) && !inBlocks(blocks, register);
      });
      expect(outside).toEqual([]);
    });
  });
});

/** A Map that records every register a builder asks for. */
class RecordingMap extends Map<number, number> {
  readonly reads = new Set<number>();
  override get(key: number): number | undefined {
    this.reads.add(key);
    return super.get(key);
  }
  override has(key: number): boolean {
    this.reads.add(key);
    return super.has(key);
  }
}

/**
 * Build a snapshot over recording maps and return the inverter registers the builders read.
 * Battery modules and meters are separate devices, polled by the full-refresh scan, so they are
 * left out here.
 */
function registersRead(registers: RegisterCaches, context: BuildContext) {
  const holding = new RecordingMap(registers.holding);
  const input = new RecordingMap(registers.input);
  const snapshot = buildSnapshot({ ...registers, holding, input }, context);
  return { snapshot, holding: [...holding.reads], input: [...input.reads] };
}

describe('every inverter register a snapshot builder reads is in a polled block', () => {
  const fixtures = [
    { name: 'reference (Gen3, ARM 316)', registers: reference() },
    ...INVERTER_CAPTURES.map(({ name, inject }) => ({ name, registers: capture(name, inject) })),
  ];

  it.each(fixtures)('$name', ({ registers }) => {
    const context = contextFor(registers);
    const { snapshot, holding, input } = registersRead(registers, context);
    const holdingBlocks = holdingBlocksFor(context.layout, context.capabilities, true);
    const inputBlocks = inputBlocksFor(context.layout, true);
    // The sanity registers are read even when the check fails, so they are always covered.
    expect(holding.filter((register) => !inBlocks(holdingBlocks, register)), 'holding').toEqual([]);
    expect(input.filter((register) => !inBlocks(inputBlocks, register)), 'input').toEqual([]);
    // The HV Gen3 capture has no HR 0–179 block, so its sanity check fails and only those
    // registers are read; every other fixture builds a snapshot.
    if (snapshot === null) expect(registers.holding.has(34)).toBe(false);
  });

  describe.each(['single_phase', 'three_phase'] as const)('on %s, under any capabilities', (layout) => {
    // Forcing the capabilities makes every gated builder read its registers. The reference unit
    // stands in for single-phase, the three-phase capture for three-phase.
    const registers = layout === 'single_phase' ? reference() : capture('hybrid_3ph.log');
    it.each(reachableCapabilities(layout))('%s', (_name, capabilities) => {
      const context = { ...contextFor(registers), capabilities } as BuildContext;
      const { snapshot, holding, input } = registersRead(registers, context);
      expect(snapshot).not.toBeNull();
      const holdingBlocks = holdingBlocksFor(layout, capabilities, true);
      expect(holding.filter((register) => !inBlocks(holdingBlocks, register)), 'holding').toEqual([]);
      expect(input.filter((register) => !inBlocks(inputBlocksFor(layout, true), register)), 'input').toEqual([]);
    });
  });
});
