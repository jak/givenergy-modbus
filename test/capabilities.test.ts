import { describe, it, expect } from 'vitest';
import { capabilitiesFor } from '../src/model/capabilities.js';
import type { InverterModel } from '../src/model/models.js';

// Rules from docs/plans/2026-11-19-v3-research.md section B.
describe('capabilitiesFor', () => {
  it('gives the reference Gen3 (ARM 316) ten slots, pause mode and window, and the HR 300 block', () => {
    expect(capabilitiesFor('hybrid_gen3', 316)).toEqual({
      tenSlots: true, perSlotTargets: true, pauseMode: true, pauseWindow: true,
      acSettingsBlock: true, highVoltageBattery: false, smartLoad: false,
    });
  });

  it('gives Gen3 at ARM 302 only the legacy slots (ten slots need ARM > 302)', () => {
    expect(capabilitiesFor('hybrid_gen3', 302)).toMatchObject({ tenSlots: false, perSlotTargets: false });
    expect(capabilitiesFor('hybrid_gen3', 303)).toMatchObject({ tenSlots: true, perSlotTargets: true });
  });

  it('gives ten slots and per-slot targets to the newer single-phase models regardless of firmware', () => {
    for (const m of ['hybrid_gen4', 'all_in_one', 'all_in_one_hybrid', 'hybrid_hv_gen3'] as const) {
      expect(capabilitiesFor(m, 0), m).toMatchObject({ tenSlots: true, perSlotTargets: true });
    }
  });

  it('gives older single-phase models only the legacy slots', () => {
    for (const m of ['hybrid_gen1', 'hybrid_gen2', 'hybrid_gen3_plus', 'polar', 'pv', 'ac'] as const) {
      expect(capabilitiesFor(m, 999), m).toMatchObject({ tenSlots: false, perSlotTargets: false });
    }
  });

  it('allows the Gen1 pause mode from ARM 187 but never the pause window (Gen1 rejects HR 319/320)', () => {
    expect(capabilitiesFor('hybrid_gen1', 186).pauseMode).toBe(false);
    expect(capabilitiesFor('hybrid_gen1', 187).pauseMode).toBe(true);
    expect(capabilitiesFor('hybrid_gen1', 451).pauseWindow).toBe(false);
  });

  it('allows the AC pause mode from ARM 200, without the window', () => {
    expect(capabilitiesFor('ac', 199).pauseMode).toBe(false);
    expect(capabilitiesFor('ac', 200).pauseMode).toBe(true);
    expect(capabilitiesFor('ac', 282).pauseWindow).toBe(false);
  });

  it('gives pause mode and window to the other paused single-phase models at any firmware', () => {
    for (const m of ['all_in_one', 'hybrid_gen2', 'hybrid_gen3', 'hybrid_hv_gen3', 'all_in_one_hybrid'] as const) {
      expect(capabilitiesFor(m, 0), m).toMatchObject({ pauseMode: true, pauseWindow: true });
    }
  });

  it('has no pause controls on Gen4, Gen3 Plus, Polar or PV (not listed in research B)', () => {
    for (const m of ['hybrid_gen4', 'hybrid_gen3_plus', 'polar', 'pv'] as const) {
      expect(capabilitiesFor(m, 999), m).toMatchObject({ pauseMode: false, pauseWindow: false });
    }
  });

  it('has no pause controls on three-phase', () => {
    for (const m of ['hybrid_3ph', 'ac_3ph', 'all_in_one_commercial'] as const) {
      expect(capabilitiesFor(m, 999), m).toMatchObject({ pauseMode: false, pauseWindow: false });
    }
  });

  it('gives three-phase slots 3-10 and per-slot targets', () => {
    expect(capabilitiesFor('hybrid_3ph', 0)).toMatchObject({ tenSlots: true, perSlotTargets: true });
    expect(capabilitiesFor('ac_3ph', 0)).toMatchObject({ tenSlots: true, perSlotTargets: true });
  });

  it('gives the commercial All in One ten slots but no per-slot targets, following research section B', () => {
    expect(capabilitiesFor('all_in_one_commercial', 0)).toMatchObject({ tenSlots: true, perSlotTargets: false });
  });

  it('enables the HR 300 settings block on AC, All in One, All in One Hybrid and Gen3 (the reference Gen3 answers HR 300-359)', () => {
    for (const m of ['ac', 'all_in_one', 'hybrid_gen3', 'all_in_one_hybrid'] as const) {
      expect(capabilitiesFor(m, 316).acSettingsBlock, m).toBe(true);
    }
  });

  it('disables the HR 300 block on Gen1 although it supports HR 313/314, because polling the block would touch HR 319/320 which Gen1 rejects', () => {
    expect(capabilitiesFor('hybrid_gen1', 451).acSettingsBlock).toBe(false);
  });

  it('disables the HR 300 block on every other model', () => {
    const others: InverterModel[] = ['hybrid_gen2', 'hybrid_gen3_plus', 'hybrid_gen4', 'hybrid_hv_gen3',
      'polar', 'pv', 'hybrid_3ph', 'ac_3ph', 'all_in_one_commercial'];
    for (const m of others) {
      expect(capabilitiesFor(m, 999).acSettingsBlock, m).toBe(false);
    }
  });

  it('never enables smart load (HR 540+ times out on every model seen)', () => {
    for (const m of ['hybrid_gen1', 'hybrid_gen2', 'hybrid_gen3', 'all_in_one'] as const) {
      expect(capabilitiesFor(m, 999).smartLoad).toBe(false);
    }
  });

  it('marks high-voltage battery models', () => {
    expect(capabilitiesFor('hybrid_hv_gen3', 295).highVoltageBattery).toBe(true);
    expect(capabilitiesFor('hybrid_gen3', 316).highVoltageBattery).toBe(false);
  });
});
