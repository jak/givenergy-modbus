import { describe, expect, it } from 'vitest';
import { buildEnergy } from '../../src/snapshot/energy.js';
import type { RegisterCaches } from '../../src/snapshot/read.js';
import {
  capture,
  contextFor,
  INVERTER_CAPTURES,
  reference,
  registersOf,
  singlePhaseContextFor,
  threePhaseContextFor,
} from '../helpers/snapshot-fixtures.js';

/** An LV battery module cache with a serial (IR 110) and the stack totals IR 105/106. */
function module(discharge: number, charge: number): Map<number, number> {
  return new Map([[105, discharge], [106, charge], [110, 0x4441]]);
}

describe('buildEnergy on the Gen3 reference unit', () => {
  const registers = reference();
  const energy = buildEnergy(registers, singlePhaseContextFor(registers));

  it('matches website/register-map.md section 2', () => {
    expect(energy.solar).toEqual({
      energyTodayKwh: 3.3, // IR 17 + IR 19 = 1.6 + 1.7 (the app shows 3.31)
      energyTotalKwh: 14515.8, // "PV generation total"
      diverterEnergyKwh: 0,
    });
    expect(energy.grid).toEqual({
      importTodayKwh: 46.6, // dump 46.6 (app 46.50 a few minutes earlier)
      exportTodayKwh: 0.2,
      importTotalKwh: 16075.4,
      exportTotalKwh: 8452.2,
    });
    expect(energy.inverter).toEqual({
      acChargeTodayKwh: 11.7, // "AC charge today" = IR 35
      acChargeTotalKwh: 4018.4, // "AC charge total" = IR 27–28
      outputTodayKwh: 15.2,
      outputTotalKwh: 17125.1,
    });
  });

  it('derives consumption as the app does: import − export + inverter out − AC charge', () => {
    // Today: 46.6 − 0.2 + 15.2 − 11.7 (the app showed 49.81, from a slightly earlier import).
    // Total: 16075.4 − 8452.2 + 17125.1 − 4018.4 (the app showed 20729.80 with import 16075.3).
    expect(energy.load).toEqual({ energyTodayKwh: 49.9, energyTotalKwh: 20729.9 });
  });

  it('reads battery totals from the battery module IR 105/106', () => {
    expect(energy.battery).toEqual({
      chargeTodayKwh: 11, // "Battery charge today 11.00 kWh"
      dischargeTodayKwh: 13.8, // "Battery discharge today 13.80 kWh"
      chargeTotalKwh: 4817, // module IR 106 = 48170
      dischargeTotalKwh: 4839.5, // module IR 105 = 48395
      throughputTotalKwh: 9656.5,
    });
  });

  it('ignores HR 180: on the reference Gen3 HR 180–186 read 0x5858 ("XX"), not a battery total', () => {
    expect([180, 181, 182, 183, 184, 185, 186].map((a) => registers.holding.get(a))).toEqual(Array(7).fill(0x5858));
    // Force the fallback past the battery module and IR 180/181, where 2.x read HR 180.
    const withoutModule: RegisterCaches = { holding: registers.holding, input: registers.input, batteryModules: [] };
    const withoutHr180: RegisterCaches = { ...withoutModule, holding: new Map(registers.holding) };
    withoutHr180.holding.delete(180);
    const context = singlePhaseContextFor(registers);
    expect(buildEnergy(withoutModule, context).battery).toEqual(buildEnergy(withoutHr180, context).battery);
    // IR 180/181 read 0 on this unit, so with no module there is no battery total at all.
    expect(buildEnergy(withoutModule, context).battery).not.toHaveProperty('dischargeTotalKwh');
  });
});

describe('battery total fallback', () => {
  const build = (registers: RegisterCaches) => buildEnergy(registers, singlePhaseContextFor(registers)).battery;
  const base = { 0: 0x2001, 21: 316 };

  it('ignores HR 4109–4112: they are write-only seed registers, not live totals', () => {
    const seeds = { ...base, 4109: 0, 4110: 9999, 4111: 0, 4112: 8888 };
    expect(build({ ...registersOf(seeds), batteryModules: [module(100, 200)] })).toMatchObject({
      chargeTotalKwh: 20,
      dischargeTotalKwh: 10,
    });
    expect(build(registersOf(seeds, { 180: 300, 181: 400 }))).toMatchObject({
      chargeTotalKwh: 40,
      dischargeTotalKwh: 30,
    });
  });

  it('uses the first module only: IR 105/106 are stack totals that every pack repeats', () => {
    // The AC capture's two packs both report IR 105 = 22003, IR 106 = 31750.
    const ac = capture('ac_arm282.log');
    expect(build(ac)).toMatchObject({ chargeTotalKwh: 3175, dischargeTotalKwh: 2200.3 });
  });

  it('skips empty module slots (no serial at IR 110–114)', () => {
    const empty = new Map([[105, 5], [106, 6]]);
    expect(build({ ...registersOf(base), batteryModules: [empty, module(100, 200)] })).toMatchObject({
      chargeTotalKwh: 20,
    });
  });

  it('falls back to IR 180/181 when the module totals read 0 (Gen1 capture)', () => {
    const gen1 = capture('hybrid_gen1_arm449.log');
    expect(build(gen1)).toMatchObject({ chargeTotalKwh: 1843, dischargeTotalKwh: 1571.1 });
  });

  it('leaves the totals out rather than show IR 27–28, which is the AC charge total, not a battery total', () => {
    // 2.x fell back to IR 27–28 / IR 29 last. IR 27–28 is "AC charge total" in the app
    // (website/register-map.md section 2), so the totals are absent when every battery source is 0.
    const battery = build(registersOf(base, { 27: 1, 28: 4, 29: 70 }));
    expect(battery).not.toHaveProperty('chargeTotalKwh');
    expect(battery).not.toHaveProperty('dischargeTotalKwh');
    expect(build(registersOf(base))).not.toHaveProperty('chargeTotalKwh');
  });

  it('sums high-voltage stacks, which are separate packs (All in One capture)', () => {
    const aio = capture('all_in_one_arm620.log');
    expect(build(aio)).toMatchObject({ chargeTotalKwh: 2060.5, dischargeTotalKwh: 1401.4 });
    const twoStacks: RegisterCaches = { ...aio, batteryStacks: [aio.batteryStacks![0], { ...aio.batteryStacks![0], index: 1 }] };
    expect(build(twoStacks)).toMatchObject({ chargeTotalKwh: 4121, dischargeTotalKwh: 2802.8 });
  });

  it('reads Gen1 battery today counters from IR 182/183, others from IR 36/37', () => {
    const today = { 36: 11, 37: 22, 182: 33, 183: 44 };
    expect(build(registersOf(base, today))).toMatchObject({ chargeTodayKwh: 1.1, dischargeTodayKwh: 2.2 });
    const gen1 = registersOf({ 0: 0x2001, 21: 449 }, today);
    expect(build(gen1)).toMatchObject({ chargeTodayKwh: 4.4, dischargeTodayKwh: 3.3 });
  });
});

describe('consumption quirks', () => {
  it('never goes below zero', () => {
    const registers = registersOf({ 0: 0x2001, 21: 316 }, { 25: 100, 35: 50 });
    expect(buildEnergy(registers, singlePhaseContextFor(registers)).load.energyTodayKwh).toBe(0);
  });
});

describe('buildEnergy on three-phase (IR 1360–1413)', () => {
  const registers = capture('hybrid_3ph.log');
  const energy = buildEnergy(registers, threePhaseContextFor(registers));

  it('reads every counter as uint32 ÷10', () => {
    expect(energy.solar).toEqual({ energyTodayKwh: 25.4, energyTotalKwh: 6660 });
    expect(energy.grid).toEqual({
      importTodayKwh: 19.8,
      importTotalKwh: 18249.6,
      exportTodayKwh: 21.7,
      exportTotalKwh: 14501.3,
    });
    expect(energy.inverter).toEqual({
      outputTodayKwh: 5.7,
      outputTotalKwh: 10703.5,
      acChargeTodayKwh: 11.1,
      acChargeTotalKwh: 14501.8,
    });
    // Three-phase reports load energy directly instead of deriving it.
    expect(energy.load).toEqual({ energyTodayKwh: 19.4, energyTotalKwh: 12582 });
    expect(energy.battery).toEqual({
      chargeTodayKwh: 9.1,
      dischargeTodayKwh: 6.6,
      chargeTotalKwh: 12229.2,
      dischargeTotalKwh: 11099.4,
    });
  });
});

describe('three-phase battery totals', () => {
  const threePhase = (input: Record<number, number>) => {
    const registers = registersOf({ 0: 0x4001 }, input);
    return buildEnergy(registers, threePhaseContextFor(registers)).battery;
  };

  it('leaves the lifetime totals out when IR 1390–1395 are unread or read 0, as single-phase does', () => {
    expect(threePhase({})).not.toHaveProperty('chargeTotalKwh');
    expect(threePhase({})).not.toHaveProperty('dischargeTotalKwh');
    expect(threePhase({ 1390: 0, 1391: 0, 1394: 0, 1395: 0 })).not.toHaveProperty('chargeTotalKwh');
    expect(threePhase({ 1390: 0, 1391: 10, 1394: 0, 1395: 20 })).toMatchObject({ chargeTotalKwh: 2, dischargeTotalKwh: 1 });
  });
});

describe.each(INVERTER_CAPTURES)('buildEnergy on capture $name', ({ name, inject }) => {
  it('decodes without throwing and gives plausible values', () => {
    const registers = capture(name, inject);
    const energy = buildEnergy(registers, contextFor(registers));
    const counters = [
      energy.solar.energyTodayKwh, energy.solar.energyTotalKwh,
      ...Object.values(energy.grid), ...Object.values(energy.inverter),
      energy.load.energyTodayKwh, energy.load.energyTotalKwh,
      ...Object.values(energy.battery),
    ];
    for (const value of counters) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1_000_000);
    }
    expect(energy.grid.importTodayKwh).toBeLessThan(500);
  });
});
