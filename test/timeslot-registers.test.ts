import { describe, it, expect } from 'vitest';
import { CHARGE_SLOT_REGISTERS, DISCHARGE_SLOT_REGISTERS } from '../src/timeslot-registers.js';

// Pins the slot layout to what the official GivEnergy app's Direct Control screen shows for a
// Gen3 Hybrid (firmware 316), cross-checked against a live dump. See website/register-map.md.

describe('Gen3 timeslot registers (matches official app)', () => {
  it('has 10 charge and 10 discharge slots, as the app reports', () => {
    expect(CHARGE_SLOT_REGISTERS).toHaveLength(10);
    expect(DISCHARGE_SLOT_REGISTERS).toHaveLength(10);
  });

  it('charge slot 1 keeps its legacy times (94/95) but takes its SOC limit from HR 242', () => {
    expect(CHARGE_SLOT_REGISTERS[0]).toEqual({ start: 94, end: 95, targetStateOfCharge: 242 });
  });

  it('charge slot 2 uses the Gen3 block (243-245), not legacy HR 31/32', () => {
    // HR 31/32 read 1 / 4 on the reference unit, and the app ignores them.
    expect(CHARGE_SLOT_REGISTERS[1]).toEqual({ start: 243, end: 244, targetStateOfCharge: 245 });
  });

  it('charge slots 3-10 are consecutive start/end/SOC triples from HR 246', () => {
    for (let slot = 3; slot <= 10; slot++) {
      const base = 246 + 3 * (slot - 3);
      expect(CHARGE_SLOT_REGISTERS[slot - 1]).toEqual({ start: base, end: base + 1, targetStateOfCharge: base + 2 });
    }
  });

  it('discharge slot 1 keeps legacy times (56/57) with its SOC limit at HR 272', () => {
    // Quirk: GivTCP-derived labels called 272/273 "discharge_slot_1_start/end"; 272 is
    // actually the slot 1 lower SOC limit, and 273/274 aren't exposed by the app at all.
    expect(DISCHARGE_SLOT_REGISTERS[0]).toEqual({ start: 56, end: 57, targetStateOfCharge: 272 });
  });

  it('discharge slot 2 keeps legacy times (44/45) with its SOC limit at HR 275', () => {
    expect(DISCHARGE_SLOT_REGISTERS[1]).toEqual({ start: 44, end: 45, targetStateOfCharge: 275 });
  });

  it('never maps a slot onto the unexposed HR 273/274', () => {
    const used = DISCHARGE_SLOT_REGISTERS.flatMap(r => [r.start, r.end, r.targetStateOfCharge]);
    expect(used).not.toContain(273);
    expect(used).not.toContain(274);
  });

  it('discharge slots 3-10 are consecutive start/end/SOC triples from HR 276', () => {
    for (let slot = 3; slot <= 10; slot++) {
      const base = 276 + 3 * (slot - 3);
      expect(DISCHARGE_SLOT_REGISTERS[slot - 1]).toEqual({ start: base, end: base + 1, targetStateOfCharge: base + 2 });
    }
  });
});
