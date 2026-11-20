import { describe, expect, it } from 'vitest';
import { buildSchedules } from '../../src/snapshot/schedules.js';
import {
  capture,
  contextFor,
  INVERTER_CAPTURES,
  reference,
  registersOf,
  singlePhaseContextFor,
  threePhaseContextFor,
} from '../helpers/snapshot-fixtures.js';
import { buildForLayout } from '../../src/snapshot/read.js';

const unsetSlot = (targetStateOfCharge: number) => ({ start: '00:00', end: '00:00', targetStateOfCharge });

describe('buildSchedules on the Gen3 reference unit (ARM 316, ten slots)', () => {
  const registers = reference();
  const schedules = buildSchedules(registers, singlePhaseContextFor(registers));

  it('reads ten charge slots with targets (website/register-map.md section 1)', () => {
    expect(schedules.charge).toEqual([
      { start: '23:30', end: '05:30', targetStateOfCharge: 100 }, // HR 94/95, target HR 242
      unsetSlot(100), // slot 2: HR 243/244, not HR 31/32 (which read 1 and 4)
      unsetSlot(69),
      ...Array(7).fill(unsetSlot(100)),
    ]);
  });

  it('reads ten discharge slots with targets, slot 1 from HR 56/57', () => {
    expect(schedules.discharge).toEqual([
      unsetSlot(40), // HR 56/57, target HR 272
      unsetSlot(50), // HR 44/45, target HR 275
      ...Array(8).fill(unsetSlot(4)),
    ]);
  });

  it('reads battery pause off at the time of the scan (HR 318–320 = 0)', () => {
    // The 17:30–18:00 pause verified in the app on 2026-11-19 had been cleared by the 22:28 scan,
    // matching register map section 1: "Pause Off", 00:00 / 00:00.
    expect(schedules.batteryPause).toEqual({ mode: 'off', start: '00:00', end: '00:00' });
  });
});

describe('schedule quirks', () => {
  const gen3 = (holding: Record<number, number>) => {
    const registers = registersOf({ 0: 0x2001, 21: 316, ...holding });
    return buildSchedules(registers, singlePhaseContextFor(registers));
  };

  it('reads HR 319 as the pause start and HR 320 as the end, without the 2.x swap', () => {
    // Verified on the reference unit (design doc): a pause set in the app for 17:30–18:00 is
    // stored as HR 319 = 1730, HR 320 = 1800. 2.x reported it the other way round.
    expect(gen3({ 318: 3, 319: 1730, 320: 1800 }).batteryPause).toEqual({ mode: 'both', start: '17:30', end: '18:00' });
  });

  it('decodes HR 318 = 3 as "both", which the app sets automatically when a pause window is set', () => {
    expect(gen3({ 318: 3 }).batteryPause?.mode).toBe('both');
    expect(gen3({ 318: 1 }).batteryPause?.mode).toBe('charge');
    expect(gen3({ 318: 2 }).batteryPause?.mode).toBe('discharge');
  });

  it('reads discharge slot 1 from HR 56/57 and its target from HR 272', () => {
    // The same dump: a 17:00–17:30 discharge slot is HR 56/57 = 1700/1730 with HR 59 = 1, HR 272 = 4.
    expect(gen3({ 56: 1700, 57: 1730, 272: 4 }).discharge[0]).toEqual({ start: '17:00', end: '17:30', targetStateOfCharge: 4 });
  });

  it('reads charge slot 2 from HR 243/244 on ten-slot firmware and HR 31/32 before it', () => {
    expect(gen3({ 94: 0, 95: 0, 31: 100, 32: 200, 243: 300, 244: 400 }).charge[1]).toMatchObject({ start: '03:00', end: '04:00' });
    const legacy = registersOf({ 0: 0x2001, 21: 302, 94: 0, 95: 0, 31: 100, 32: 200, 243: 300, 244: 400 });
    const context = singlePhaseContextFor(legacy);
    expect(context.capabilities.tenSlots).toBe(false);
    expect(buildSchedules(legacy, context).charge).toEqual([
      { start: '00:00', end: '00:00' },
      { start: '01:00', end: '02:00' },
    ]);
  });

  it('uses two charge and two discharge slots without targets on legacy firmware (Gen2)', () => {
    const registers = registersOf({ 0: 0x2001, 21: 920, 94: 2330, 95: 530, 31: 0, 32: 0, 56: 1600, 57: 1900, 44: 0, 45: 0 });
    const schedules = buildSchedules(registers, singlePhaseContextFor(registers));
    expect(schedules.charge).toEqual([{ start: '23:30', end: '05:30' }, { start: '00:00', end: '00:00' }]);
    expect(schedules.discharge).toEqual([{ start: '16:00', end: '19:00' }, { start: '00:00', end: '00:00' }]);
    expect(schedules.batteryPause).toBeUndefined(); // HR 318 not read
  });

  it('reads an unset slot as 00:00–00:00 and normalises 2400 to 00:00, as 2.x does', () => {
    expect(gen3({ 94: 0, 95: 2400 }).charge[0]).toMatchObject({ start: '00:00', end: '00:00' });
  });

  it('leaves out a slot whose start or end register is unread, rather than show a fake 00:00–00:00 slot', () => {
    // A full poll reads every slot register, so this only happens with partial data.
    const legacy = (holding: Record<number, number>) => {
      const registers = registersOf({ 0: 0x2001, 21: 920, ...holding });
      return buildSchedules(registers, singlePhaseContextFor(registers));
    };
    expect(legacy({ 94: 2330, 95: 530, 31: 100 }).charge).toEqual([{ start: '23:30', end: '05:30' }]);
    expect(legacy({ 95: 530, 31: 100, 32: 200 }).charge).toEqual([{ start: '01:00', end: '02:00' }]);
    expect(legacy({}).discharge).toEqual([]);
  });

  it('leaves out a slot target whose register is unread, rather than show 0 %', () => {
    expect(gen3({ 94: 2330, 95: 530 }).charge[0]).toEqual({ start: '23:30', end: '05:30' });
    expect(gen3({ 94: 2330, 95: 530, 242: 80 }).charge[0]).toEqual({ start: '23:30', end: '05:30', targetStateOfCharge: 80 });
  });

  it('decodes an unnamed HR 318 value as "unknown", like the catalogue enums (2.x read it as off)', () => {
    expect(gen3({ 318: 4 }).batteryPause?.mode).toBe('unknown');
  });

  it('gives Gen1 the pause mode only: it rejects any access touching HR 319/320', () => {
    const registers = registersOf({ 0: 0x2001, 21: 449, 318: 2, 319: 1730, 320: 1800 });
    expect(buildSchedules(registers, singlePhaseContextFor(registers)).batteryPause).toEqual({ mode: 'discharge' });
  });

  it('has no battery pause where the model has no pause mode', () => {
    const registers = registersOf({ 0: 0x2001, 21: 150, 318: 1 }); // Gen1 ARM < 187
    expect(buildSchedules(registers, singlePhaseContextFor(registers))).not.toHaveProperty('batteryPause');
  });

  it('leaves battery pause out when HR 318 has not been read', () => {
    expect(gen3({})).not.toHaveProperty('batteryPause');
  });
});

describe('buildSchedules on three-phase', () => {
  const registers = capture('hybrid_3ph.log');
  const schedules = buildSchedules(registers, threePhaseContextFor(registers));

  it('reads slots 1/2 from HR 1113–1116 (charge) and 1118–1121 (discharge), without targets', () => {
    expect(schedules.charge.slice(0, 2)).toEqual([{ start: '01:00', end: '01:00' }, { start: '00:00', end: '00:00' }]);
    expect(schedules.discharge.slice(0, 2)).toEqual([{ start: '01:00', end: '01:00' }, { start: '00:00', end: '00:00' }]);
  });

  it('leaves out slots 3–10 (HR 246–299), which this capture never read, rather than zero-fill them', () => {
    // Ten-slot firmware: slots 3–10 and their targets are in HR 246–299 as on single-phase.
    // 2.x-style zero-filling showed them as 00:00–00:00 slots with 0 % targets.
    expect(threePhaseContextFor(registers).capabilities.tenSlots).toBe(true);
    expect(schedules.charge).toHaveLength(2);
    expect(schedules.discharge).toHaveLength(2);
    expect(schedules).not.toHaveProperty('batteryPause');
  });
});

describe('slots the captures never read', () => {
  const lengths = (name: string, inject?: Record<number, number>) => {
    const registers = capture(name, inject);
    const schedules = buildForLayout(buildSchedules, registers, contextFor(registers));
    return [schedules.charge.length, schedules.discharge.length];
  };

  it('AC: charge slot 1 (HR 94/95) is not in the capture, so only legacy slot 2 (HR 31/32) is listed', () => {
    expect(lengths('ac_arm282.log')).toEqual([1, 2]);
  });

  it('HV Gen3: no HR 0–179 block, so charge slot 1 and discharge slots 1–2 are left out', () => {
    expect(lengths('hybrid_hv_gen3_arm295.log', { 0: 0x8102, 21: 295 })).toEqual([9, 8]);
  });

  it('every slot register is read on Gen1, Gen2 and the All in One', () => {
    expect(lengths('hybrid_gen1_arm449.log')).toEqual([2, 2]);
    expect(lengths('hybrid_gen2_arm920.log')).toEqual([2, 2]);
    expect(lengths('all_in_one_arm620.log')).toEqual([10, 10]);
  });
});

describe.each(INVERTER_CAPTURES)('buildSchedules on capture $name', ({ name, inject }) => {
  it('decodes without throwing, with valid times and slot counts', () => {
    const registers = capture(name, inject);
    const context = contextFor(registers);
    const schedules = buildForLayout(buildSchedules, registers, context);
    // Fewer when a capture lacks some slot registers: unread slots are left out.
    const count = context.capabilities.tenSlots ? 10 : 2;
    expect(schedules.charge.length).toBeLessThanOrEqual(count);
    expect(schedules.discharge.length).toBeLessThanOrEqual(count);
    for (const slots of [schedules.charge, schedules.discharge]) {
      slots.forEach((slot, index) => {
        expect(slot.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        expect(slot.end).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        // No source gives targets for three-phase slots 1/2 (HR 1113–1121).
        const hasTarget = context.capabilities.perSlotTargets && !(context.layout === 'three_phase' && index < 2);
        expect('targetStateOfCharge' in slot).toBe(hasTarget);
      });
    }
  });
});
