import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../src/snapshot/index.js';
import { isPlantController, resolveModel } from '../../src/model/models.js';
import type { RegisterCaches } from '../../src/snapshot/read.js';
import { loadCapture } from '../helpers/capture.js';
import {
  capture,
  contextFor,
  INVERTER_CAPTURES,
  reference,
  singlePhaseContextFor,
  threePhaseContextFor,
} from '../helpers/snapshot-fixtures.js';

describe('buildSnapshot on the Gen3 reference unit', () => {
  const registers = reference();
  const snapshot = buildSnapshot(registers, singlePhaseContextFor(registers));

  it('assembles every group (website/register-map.md sections 1–2)', () => {
    expect(snapshot).not.toBeNull();
    const s = snapshot!;
    expect(s.layout).toBe('single_phase');
    expect(s.model).toBe('hybrid_gen3');
    expect(s.capabilities).toMatchObject({ tenSlots: true, perSlotTargets: true, pauseMode: true, acSettingsBlock: true });
    expect(s.identity).toMatchObject({ serialNumber: 'FD0000A000', deviceTypeCode: 0x2001, ratedPower: 5000 });
    expect(s.identity.firmware).toEqual({ dsp: 316, arm: 316, batteryManagementSystem: 4009, modbusVersion: 1.4 });
    expect(s.status).toMatchObject({ inverterStatus: 'normal', faults: [], batteryWarnings: [] });
    expect(s.solar).toMatchObject({ power: 0, energyTodayKwh: 3.3, energyTotalKwh: 14515.8 });
    expect(s.solar.strings.map((string) => string.energyTodayKwh)).toEqual([1.6, 1.7]);
    expect(s.battery).toMatchObject({ voltage: 50.64, stateOfCharge: 5, temperature: 19, chargerTemperature: 27.8 });
    expect(s.battery.energy).toMatchObject({ chargeTodayKwh: 11, dischargeTodayKwh: 13.8 });
    expect(s.battery.modules).toHaveLength(1);
    expect(s.battery.modules[0]).toMatchObject({ kind: 'low_voltage', serialNumber: 'DZ0000B000' });
    expect(s.grid).toMatchObject({ power: -360, frequency: 50.09 });
    expect(s.grid.energy).toEqual({ importTodayKwh: 46.6, exportTodayKwh: 0.2, importTotalKwh: 16075.4, exportTotalKwh: 8452.2 });
    expect(s.inverter).toMatchObject({ heatsinkTemperature: 28.9, outputPower: -49 });
    expect(s.inverter.energy).toMatchObject({ acChargeTodayKwh: 11.7, acChargeTotalKwh: 4018.4 });
    expect(s.eps).toMatchObject({ frequency: 50.13 });
    expect(s.load).toEqual({ power: 311, energyTodayKwh: 49.9, energyTotalKwh: 20729.9 });
    expect(s.settings).toMatchObject({ ecoMode: true, exportPriority: 'loadFirst', acChargeUpperLimit: 100, batteryReserve: 4 });
    expect(s.schedules.charge[0]).toEqual({ start: '23:30', end: '05:30', targetStateOfCharge: 100 });
    expect(s.schedules.batteryPause).toEqual({ mode: 'off', start: '00:00', end: '00:00' });
    expect(s.meters).toEqual([]);
  });

  it('derives power flows: importing 360 W for a 311 W load with no solar or battery', () => {
    expect(snapshot!.powerFlows).toEqual({
      solarToHouse: 0,
      solarToBattery: 0,
      solarToGrid: 0,
      batteryToHouse: 0,
      batteryToGrid: 0,
      gridToHouse: 360,
      gridToBattery: 0,
    });
  });

  it('round-trips through JSON: only systemTime changes, to an ISO string (Date.toJSON, as in 2.x)', () => {
    const s = snapshot!;
    const json = JSON.parse(JSON.stringify(s));
    expect(json).toStrictEqual({ ...s, status: { ...s.status, systemTime: s.status.systemTime.toISOString() } });
    expect(new Date(json.status.systemTime).getTime()).toBe(s.status.systemTime.getTime());
  });
});

describe('buildSnapshot sanity check', () => {
  const withRegister = (registers: RegisterCaches, table: 'holding' | 'input', address: number, value?: number) => {
    const copy = { ...registers, [table]: new Map(registers[table]) };
    if (value === undefined) copy[table].delete(address);
    else copy[table].set(address, value);
    return copy;
  };
  const registers = reference();
  const context = singlePhaseContextFor(registers);

  it('returns null for a corrupt block, as 2.x does', () => {
    expect(buildSnapshot(withRegister(registers, 'holding', 34, 300), context)).toBeNull(); // Modbus version 3.00
    expect(buildSnapshot(withRegister(registers, 'holding', 30, 101), context)).toBeNull();
    expect(buildSnapshot(withRegister(registers, 'holding', 33, 101), context)).toBeNull();
    expect(buildSnapshot(withRegister(registers, 'input', 41, 1001), context)).toBeNull(); // 100.1 °C
  });

  it('returns null when a sanity register has not been read, because a partial read looks valid (GivTCP #583)', () => {
    for (const [table, address] of [['holding', 30], ['holding', 33], ['holding', 34], ['input', 41]] as const) {
      expect(buildSnapshot(withRegister(registers, table, address), context), `${table} ${address}`).toBeNull();
    }
    // The HV Gen3 capture has no HR 0–179 block at all.
    const hvGen3 = capture('hybrid_hv_gen3_arm295.log', { 0: 0x8102, 21: 295 });
    expect(buildSnapshot(hvGen3, contextFor(hvGen3))).toBeNull();
  });

  it('checks the three-phase heatsink at IR 1128, not IR 41', () => {
    const threePhase = capture('hybrid_3ph.log');
    expect(threePhase.input.get(41)).toBe(0);
    const hot = withRegister(threePhase, 'input', 1128, 1001);
    expect(buildSnapshot(hot, threePhaseContextFor(hot))).toBeNull();
  });
});

/**
 * The HV Gen3 capture holds no HR 0–179 block, so it needs the identity and sanity registers
 * injected. These are the values every other capture reads (HR 30 = 17, HR 33 = 7, HR 34 = 140).
 */
const SNAPSHOT_INJECT: Record<string, Record<number, number>> = {
  'hybrid_hv_gen3_arm295.log': { 30: 17, 33: 7, 34: 140 },
};

/** The path of every number in `value` that is NaN or ±Infinity. */
function nonFiniteNumbers(value: unknown, path = 'snapshot'): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path} = ${value}`];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => nonFiniteNumbers(child, `${path}.${key}`));
}

describe('nonFiniteNumbers', () => {
  it('finds NaN and Infinity at any depth, including inside arrays', () => {
    expect(nonFiniteNumbers({ a: 1, b: { c: [2, Number.NaN] }, d: -Infinity, e: 'x', f: null })).toEqual([
      'snapshot.b.c.1 = NaN',
      'snapshot.d = -Infinity',
    ]);
  });
});

describe.each(INVERTER_CAPTURES)('buildSnapshot on capture $name', ({ name, inject }) => {
  it('builds a snapshot of the right layout', () => {
    const registers = capture(name, { ...inject, ...SNAPSHOT_INJECT[name] });
    const context = contextFor(registers);
    const snapshot = buildSnapshot(registers, context);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.layout).toBe(context.layout);
    expect(snapshot!.model).toBe(context.model);
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    // No NaN or Infinity, which JSON would silently turn into null.
    expect(nonFiniteNumbers(snapshot)).toEqual([]);
  });
});

describe('plant controllers', () => {
  it.each(['ems_arm1036.log', 'gateway_gaaa0014.log'])('%s is not an inverter, so no snapshot is built', (name) => {
    const holding = loadCapture(name).slave(0x11).holding;
    const model = resolveModel(holding.get(0) ?? 0, holding.get(21) ?? 0);
    // connect() throws UnsupportedDeviceError for these (Phase D); the snapshot builder never sees them.
    expect(isPlantController(model)).toBe(true);
    expect(() => contextFor({ holding, input: new Map() })).toThrow(/not an inverter/);
  });
});
