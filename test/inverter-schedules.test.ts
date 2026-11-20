import { afterEach, describe, expect, it } from 'vitest';
import { UnsupportedSettingError } from '../src/errors.js';
import { capture, reference } from './helpers/snapshot-fixtures.js';
import { devicesOf } from './helpers/mock-inverter.js';
import { connectSinglePhase, connectThreePhase, disconnectAll } from './helpers/connect-mock.js';

afterEach(disconnectAll);

/** Gen3 ARM 316: ten slots, per-slot targets, pause mode and window. */
const gen3 = () => connectSinglePhase(devicesOf(reference()));
/** Gen2 ARM 920: two slots, no targets, pause mode and window. */
const gen2 = () => connectSinglePhase(devicesOf(capture('hybrid_gen2_arm920.log')));
/** Gen1 ARM 449: two slots, pause mode without the window. */
const gen1 = () => connectSinglePhase(devicesOf(capture('hybrid_gen1_arm449.log')));
/** Gen1 ARM 186: below the ARM 187 pause mode threshold. */
const gen1WithoutPause = () => connectSinglePhase(devicesOf(capture('hybrid_gen1_arm449.log', { 21: 186 })));
/** Hybrid 3-phase: ten slots; slots 1/2 at HR 1113–1121 without targets. */
const threePhase = () => connectThreePhase(devicesOf(capture('hybrid_3ph.log')));

describe('charge and discharge slots', { timeout: 20_000 }, () => {
  it('writes charge slot 2 to HR 243/244 on ten-slot firmware', async () => {
    const { mock, inverter } = await gen3();
    await inverter.setChargeSlot(2, { start: '01:30', end: '04:00' });
    expect(mock.writes).toEqual([{ register: 243, value: 130 }, { register: 244, value: 400 }]);
    expect(inverter.getData().schedules.charge[1]).toMatchObject({ slot: 2, start: '01:30', end: '04:00' });
  });

  it('writes charge slot 2 to legacy HR 31/32 without ten slots', async () => {
    const { mock, inverter } = await gen2();
    await inverter.setChargeSlot(2, { start: '01:30', end: '04:00' });
    expect(mock.writes).toEqual([{ register: 31, value: 130 }, { register: 32, value: 400 }]);
    expect(inverter.getData().schedules.charge[1]).toMatchObject({ slot: 2, start: '01:30', end: '04:00' });
  });

  it('writes discharge slots 1 and 2 to legacy HR 56/57 and HR 44/45', async () => {
    const { mock, inverter } = await gen3();
    await inverter.setDischargeSlot(1, { start: '16:00', end: '19:00' });
    await inverter.setDischargeSlot(2, { start: '20:00', end: '21:00' });
    expect(mock.writes).toEqual([
      { register: 56, value: 1600 }, { register: 57, value: 1900 },
      { register: 44, value: 2000 }, { register: 45, value: 2100 },
    ]);
  });

  it('throws RangeError for a slot number outside 1 to the model\'s slot count', async () => {
    const { mock, inverter } = await gen3();
    const slot = { start: '01:00', end: '02:00' };
    await expect(inverter.setChargeSlot(0, slot)).rejects.toThrow(RangeError);
    await expect(inverter.setChargeSlot(11, slot)).rejects.toThrow('charge slot must be 1-10, got 11');
    await expect(inverter.setDischargeSlot(1.5, slot)).rejects.toThrow(RangeError);
    const legacy = await gen2();
    await expect(legacy.inverter.setChargeSlot(3, slot)).rejects.toThrow('charge slot must be 1-2, got 3');
    expect(mock.writes).toEqual([]);
    expect(legacy.mock.writes).toEqual([]);
  });

  it('validates times before writing anything', async () => {
    const { mock, inverter } = await gen3();
    await expect(inverter.setChargeSlot(1, { start: '25:00', end: '02:00' })).rejects.toThrow(RangeError);
    await expect(inverter.setChargeSlot(1, { start: '01:00', end: '2pm' })).rejects.toThrow(RangeError);
    expect(mock.writes).toEqual([]);
  });

  it('accepts a slot from the snapshot, which carries its own number', async () => {
    const { mock, inverter } = await gen3();
    const slot3 = { ...inverter.getData().schedules.charge.find((slot) => slot.slot === 3)!, start: '05:00' };
    await inverter.setChargeSlot(slot3);
    expect(mock.writes.map((write) => write.register)).toEqual(
      slot3.targetStateOfCharge === undefined ? [246, 247] : [246, 247, 248],
    );
    expect(mock.writes[0]).toEqual({ register: 246, value: 500 });
  });

  describe('targets', () => {
    it('writes the slot target after the times with per-slot targets (charge slot 1 target is HR 242)', async () => {
      const { mock, inverter } = await gen3();
      await inverter.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 80 });
      await inverter.setDischargeSlot(2, { start: '17:00', end: '19:00', targetStateOfCharge: 20 });
      expect(mock.writes).toEqual([
        { register: 94, value: 30 }, { register: 95, value: 430 }, { register: 242, value: 80 },
        { register: 44, value: 1700 }, { register: 45, value: 1900 }, { register: 275, value: 20 },
      ]);
      expect(inverter.getData().schedules.charge[0]).toEqual({ slot: 1, start: '00:30', end: '04:30', targetStateOfCharge: 80 });
    });

    it('throws UnsupportedSettingError for a target without per-slot targets, where GivTCP skips it silently', async () => {
      const { mock, inverter } = await gen2();
      const error = await inverter.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 80 }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(UnsupportedSettingError);
      expect(error).toMatchObject({ key: 'chargeSlotTargetStateOfCharge', model: 'hybrid_gen2', firmware: 920 });
      expect(mock.writes).toEqual([]);
    });

    it('throws RangeError for a target outside 4–100', async () => {
      const { mock, inverter } = await gen3();
      await expect(inverter.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 3 })).rejects.toThrow(RangeError);
      await expect(inverter.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 101 })).rejects.toThrow(RangeError);
      expect(mock.writes).toEqual([]);
    });
  });

  describe('setChargeSlots / setDischargeSlots', () => {
    it('writes each slot in order and clears the rest of the model\'s slots to 00:00–00:00, times only', async () => {
      // Targets of cleared slots are left alone, as the external library's reset_charge_slot does.
      const { mock, inverter } = await gen3();
      await inverter.setChargeSlots([
        { start: '00:30', end: '04:30', targetStateOfCharge: 100 },
        { start: '13:00', end: '15:00' },
      ]);
      const cleared = [246, 249, 252, 255, 258, 261, 264, 267].flatMap((start) => [
        { register: start, value: 0 },
        { register: start + 1, value: 0 },
      ]);
      expect(mock.writes).toEqual([
        { register: 94, value: 30 }, { register: 95, value: 430 }, { register: 242, value: 100 },
        { register: 243, value: 1300 }, { register: 244, value: 1500 },
        ...cleared,
      ]);
      const charge = inverter.getData().schedules.charge;
      expect(charge).toHaveLength(10);
      expect(charge.slice(2).every((slot) => slot.start === '00:00' && slot.end === '00:00')).toBe(true);
    });

    it('clears every slot when given none', async () => {
      const { mock, inverter } = await gen2();
      await inverter.setDischargeSlots([]);
      expect(mock.writes).toEqual([
        { register: 56, value: 0 }, { register: 57, value: 0 },
        { register: 44, value: 0 }, { register: 45, value: 0 },
      ]);
    });

    it('throws RangeError for more slots than the model has, writing nothing', async () => {
      const { mock, inverter } = await gen2();
      const slot = { start: '01:00', end: '02:00' };
      await expect(inverter.setChargeSlots([slot, slot, slot])).rejects.toThrow('charge slots: 3 given, this inverter has 2');
      expect(mock.writes).toEqual([]);
    });

    it('throws RangeError when an entry\'s slot number doesn\'t match its position', async () => {
      const { mock, inverter } = await gen3();
      await expect(inverter.setChargeSlots([{ slot: 2, start: '01:00', end: '02:00' }])).rejects.toThrow(RangeError);
      expect(mock.writes).toEqual([]);
    });

    it('writes the snapshot\'s own schedule back unchanged', async () => {
      const { mock, inverter } = await gen3();
      const before = inverter.getData().schedules.charge;
      await inverter.setChargeSlots(before);
      expect(inverter.getData().schedules.charge).toEqual(before);
      expect(mock.writes.length).toBeGreaterThan(0);
    });
  });

  describe('three-phase', () => {
    it('writes charge slot 1 to HR 1113/1114 and discharge slot 2 to HR 1120/1121', async () => {
      const { mock, inverter } = await threePhase();
      await inverter.setChargeSlot(1, { start: '00:30', end: '04:30' });
      await inverter.setDischargeSlot(2, { start: '16:00', end: '19:00' });
      expect(mock.writes).toEqual([
        { register: 1113, value: 30 }, { register: 1114, value: 430 },
        { register: 1120, value: 1600 }, { register: 1121, value: 1900 },
      ]);
      expect(inverter.getData().schedules.discharge[1]).toMatchObject({ slot: 2, start: '16:00', end: '19:00' });
    });

    it('throws UnsupportedSettingError for a target on slots 1/2, which have no target register', async () => {
      const { mock, inverter } = await threePhase();
      await expect(inverter.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 80 }))
        .rejects.toBeInstanceOf(UnsupportedSettingError);
      expect(mock.writes).toEqual([]);
    });

    it('writes slots 3–10 and their targets in HR 246–299, as single-phase', async () => {
      const { mock, inverter } = await threePhase();
      await inverter.setChargeSlot(3, { start: '01:00', end: '02:00', targetStateOfCharge: 90 });
      expect(mock.writes).toEqual([{ register: 246, value: 100 }, { register: 247, value: 200 }, { register: 248, value: 90 }]);
    });
  });
});

describe('setBatteryPause', { timeout: 20_000 }, () => {
  it('writes HR 318, then HR 319 as the start and HR 320 as the end, without 2.x\'s window swap', async () => {
    const { mock, inverter } = await gen3();
    await inverter.setBatteryPause({ mode: 'discharge', start: '16:00', end: '19:00' });
    // Mode values as decoded from HR 318: 0 off, 1 charge, 2 discharge, 3 both.
    expect(mock.writes).toEqual([
      { register: 318, value: 2 },
      { register: 319, value: 1600 },
      { register: 320, value: 1900 },
    ]);
    expect(inverter.getData().schedules.batteryPause).toEqual({ mode: 'discharge', start: '16:00', end: '19:00' });
  });

  it.each([['off', 0], ['charge', 1], ['discharge', 2], ['both', 3]] as const)('writes mode %s as %i', async (mode, value) => {
    const { mock, inverter } = await gen3();
    await inverter.setBatteryPause({ mode });
    expect(mock.writes).toEqual([{ register: 318, value }]);
    expect(inverter.getData().schedules.batteryPause?.mode).toBe(mode);
  });

  it('quirk: writes only HR 318 on Gen1, which rejects HR 319/320, and refuses a window there', async () => {
    const { mock, inverter } = await gen1();
    await inverter.setBatteryPause({ mode: 'charge' });
    expect(mock.writes).toEqual([{ register: 318, value: 1 }]);
    await expect(inverter.setBatteryPause({ mode: 'charge', start: '16:00', end: '19:00' }))
      .rejects.toMatchObject({ name: 'UnsupportedSettingError', key: 'batteryPauseWindow', model: 'hybrid_gen1' });
    expect(mock.writes).toHaveLength(1);
  });

  it('throws UnsupportedSettingError without pause mode', async () => {
    const { mock, inverter } = await gen1WithoutPause();
    expect(inverter.capabilities.pauseMode).toBe(false);
    await expect(inverter.setBatteryPause({ mode: 'off' })).rejects.toMatchObject({ name: 'UnsupportedSettingError', key: 'batteryPause' });
    expect(mock.writes).toEqual([]);
  });

  it('throws RangeError for an unknown mode, a bad time, or only one end of the window', async () => {
    const { mock, inverter } = await gen3();
    await expect(inverter.setBatteryPause({ mode: 'unknown' as never })).rejects.toThrow(RangeError);
    await expect(inverter.setBatteryPause({ mode: 'both', start: '16:00' })).rejects.toThrow(RangeError);
    await expect(inverter.setBatteryPause({ mode: 'both', start: '16:00', end: '24:00' })).rejects.toThrow(RangeError);
    expect(mock.writes).toEqual([]);
  });
});

describe('data events', { timeout: 20_000 }, () => {
  it('emits one data event per call, however many registers it writes', async () => {
    const { mock, inverter } = await gen3();
    let events = 0;
    inverter.on('data', () => { events++; });
    await inverter.setChargeSlots([{ start: '00:30', end: '04:30', targetStateOfCharge: 100 }]);
    expect(mock.writes).toHaveLength(21); // slot 1 with its target, then 9 slots cleared
    expect(events).toBe(1);
    await inverter.setBatteryPause({ mode: 'discharge', start: '16:00', end: '19:00' });
    expect(events).toBe(2);
  });

  it('still applies the writes the inverter accepted when a later one fails', async () => {
    const { mock, inverter } = await gen3();
    mock.silent = (request) => request.functionCode === 0x06 && request.baseRegister === 319;
    let events = 0;
    inverter.on('data', () => { events++; });
    const before = inverter.getData().schedules.batteryPause;

    await expect(inverter.setBatteryPause({ mode: 'both', start: '16:00', end: '19:00' })).rejects.toThrow(/timeout/);

    // HR 318 was accepted, HR 319 timed out and HR 320 was never sent.
    expect(mock.writes).toEqual([{ register: 318, value: 3 }]);
    expect(events).toBe(1);
    expect(inverter.getData().schedules.batteryPause).toEqual({ ...before, mode: 'both' });
  });
});

