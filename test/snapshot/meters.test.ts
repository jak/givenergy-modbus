import { describe, expect, it } from 'vitest';
import { buildMeters } from '../../src/snapshot/meters.js';
import { capture, reference } from '../helpers/snapshot-fixtures.js';

describe('buildMeters', () => {
  it('has no meters in the reference fixture, which holds no meter registers', () => {
    expect(buildMeters(reference())).toEqual([]);
  });

  it('skips meter addresses whose phase 1 voltage reads 0 (All in One capture: 0x01–0x08 all empty)', () => {
    const registers = capture('all_in_one_arm620.log');
    expect(registers.meters).toHaveLength(8);
    expect(buildMeters(registers)).toEqual([]);
  });

  it('decodes a single-phase meter and fills the totals from phase 1 (Gen2 capture)', () => {
    const [meter] = buildMeters(capture('hybrid_gen2_arm920.log'));
    expect(meter).toMatchObject({
      slaveAddress: 1,
      voltage: [244.6, 0, 0],
      current: [2.14, 0, 0],
      activePower: [-4, 0, 0],
      activePowerTotal: -4,
      frequency: 49.98,
      importActiveEnergyKwh: 5243.4,
      exportActiveEnergyKwh: 1499.4,
    });
    // No function 22 product data in this capture.
    expect(meter).toMatchObject({ serialNumber: 0, factoryCode: '', meterType: 0 });
  });

  it('decodes product information from function 22 (three-phase capture, meter 0x02)', () => {
    const meters = buildMeters(capture('hybrid_3ph.log'));
    expect(meters.map((m) => m.slaveAddress)).toEqual([1, 2]);
    expect(meters[1]).toMatchObject({
      serialNumber: 3521 * 65536 + 18903,
      meterType: 136,
      hardwareVersion: 256,
      softwareVersion: 256,
    });
  });

});

describe('meter scaling quirks', () => {
  const gen2 = buildMeters(capture('hybrid_gen2_arm920.log'))[0];
  const hvGen3 = buildMeters(capture('hybrid_hv_gen3_arm295.log', { 0: 0x8102, 21: 295 }))[0];
  const [threePhase] = buildMeters(capture('hybrid_3ph.log'));

  it('reads apparent power as raw VA, not ÷10 as research C claims: single-phase V × I matches it', () => {
    // Gen2: 244.6 V × 2.14 A = 523 VA against IR 76 = 525. HV Gen3: 244.8 V × 18.31 A = 4482 VA
    // against 4485. ÷10 would give 52.5 and 448.5.
    expect(gen2.apparentPower[0]).toBe(525);
    expect(gen2.voltage[0] * gen2.current[0]).toBeCloseTo(gen2.apparentPower[0], -1);
    expect(hvGen3.apparentPower[0]).toBe(4485);
    expect(hvGen3.voltage[0] * hvGen3.current[0]).toBeCloseTo(hvGen3.apparentPower[0], -1);
    // Unsigned: a magnitude. 2.x read it signed, which wraps above 32767 VA.
    expect(hvGen3.apparentPowerTotal).toBe(4485);
  });

  it('keeps apparent power at or above |active power| on every three-phase phase, which ÷10 would break', () => {
    // Phase 2: P = 537 W, Q = −253 var, S = 741 VA. ÷10 would give 74.1 VA < 537 W, impossible.
    expect(threePhase.apparentPower).toEqual([468, 741, 738]);
    threePhase.apparentPower.forEach((apparent, phase) => {
      const active = threePhase.activePower[phase];
      const reactive = threePhase.reactivePower[phase];
      expect(apparent).toBeGreaterThanOrEqual(Math.hypot(active, reactive));
    });
  });

  it('decodes the power factor offset-unsigned, because signed ÷10000 gives values above 1 on the captures', () => {
    // Raw IR 80 = 10050 (Gen2), 19980 (HV Gen3), IR 80–82 = 10320 / 2770 / 17210 (three-phase):
    // signed ÷10000 would be 1.005, 1.998 and 1.032 / 0.277 / 1.721.
    expect(gen2.powerFactor[0]).toBe(0.005);
    // The single-phase meter leaves IR 83 at 0, so the total comes from phase 1.
    expect(gen2.powerFactorTotal).toBe(0.005);
    expect(hvGen3.powerFactor[0]).toBe(0.998);
    expect(threePhase.powerFactor).toEqual([0.032, -0.723, 0.721]);
    // |P / S| agrees: HV Gen3 −4490 / 4485 ≈ 1.00; three-phase phase 2 537 / 741 = 0.725.
    expect(Math.abs(hvGen3.activePower[0] / hvGen3.apparentPower[0])).toBeCloseTo(Math.abs(hvGen3.powerFactor[0]), 2);
    expect(Math.abs(threePhase.activePower[1] / threePhase.apparentPower[1])).toBeCloseTo(Math.abs(threePhase.powerFactor[1]), 2);
  });

  it('reads current ÷100, although the three-phase meter 0x01 only fits V × I = S at ÷10', () => {
    // Quirk, not special-cased: phase 2 reads IR 64 = 32. At ÷100 that is 0.32 A, and
    // 231.2 V × 0.32 A = 74 VA against S = 741 VA; at ÷10 (3.2 A) it would be 740 VA.
    expect(threePhase.current).toEqual([0.2, 0.32, 0.31]);
    expect(threePhase.voltage[1] * threePhase.current[1] * 10).toBeCloseTo(threePhase.apparentPower[1], -1);
  });
});
