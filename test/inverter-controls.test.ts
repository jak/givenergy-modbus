import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS } from '../src/catalogue/index.js';
import { UnsupportedDeviceError, UnsupportedSettingError } from '../src/errors.js';
import { GivEnergyInverter, SinglePhaseInverter } from '../src/inverter.js';
import { capture, reference } from './helpers/snapshot-fixtures.js';
import { devicesOf, startMockInverter, type MockInverter } from './helpers/mock-inverter.js';
import { connectSinglePhase, connectThreePhase, connectToMock, disconnectAll, FAST_TIMING, onDisconnect } from './helpers/connect-mock.js';

afterEach(disconnectAll);

const threePhase = () => connectThreePhase(devicesOf(capture('hybrid_3ph.log')));

const gen3 = () => connectSinglePhase(devicesOf(reference()));
const gen2 = () => connectSinglePhase(devicesOf(capture('hybrid_gen2_arm920.log')));

/** Every request after connecting was a write: nothing was read back. */
const onlyWrites = (mock: MockInverter) => mock.requests.every((request) => request.functionCode === 0x06);

describe('connect', { timeout: 20_000 }, () => {
  it('returns a single-phase inverter for the Gen3 reference unit', async () => {
    const { inverter } = await connectToMock(devicesOf(reference()));
    expect(inverter).toBeInstanceOf(SinglePhaseInverter);
    expect(inverter.layout).toBe('single_phase');
    expect(inverter.model).toBe('hybrid_gen3');
    expect(inverter.capabilities).toEqual(inverter.getData().capabilities);
    expect(inverter.capabilities.acSettingsBlock).toBe(true);
  });

  it('returns a three-phase inverter for the three-phase capture', async () => {
    const { inverter } = await threePhase();
    expect(inverter.layout).toBe('three_phase');
    expect(inverter.model).toBe('hybrid_3ph');
  });

  it('rejects an Energy Management System with UnsupportedDeviceError and closes the socket', async () => {
    const mock = await startMockInverter({ devices: new Map([[0x11, { holding: new Map([[0, 0x5101]]) }]]) });
    onDisconnect(() => mock.close());
    const result = GivEnergyInverter.connect({ host: '127.0.0.1', port: mock.port, autoReconnect: false, timing: FAST_TIMING });
    await expect(result).rejects.toBeInstanceOf(UnsupportedDeviceError);
    await expect(result).rejects.toMatchObject({ model: 'ems' });
    await vi.waitFor(() => expect(mock.connections()).toBe(0));
  });
});

describe('setSetting', { timeout: 20_000 }, () => {
  it('writes HR 110 for the battery reserve and shows it in the snapshot straight away, with no poll', async () => {
    const { mock, inverter } = await gen3();
    const data: unknown[] = [];
    inverter.on('data', (snapshot) => data.push(snapshot));

    await inverter.setSetting('batteryReserve', 20);

    expect(mock.writes).toEqual([{ register: 110, value: 20 }]);
    expect(onlyWrites(mock)).toBe(true);
    expect(inverter.getData().settings.batteryReserve).toBe(20);
    expect(data).toHaveLength(1);
  });

  it('writes HR 1109 for the battery reserve on three-phase', async () => {
    const { mock, inverter } = await threePhase();
    await inverter.setSetting('batteryReserve', 20);
    expect(mock.writes).toEqual([{ register: 1109, value: 20 }]);
    expect(inverter.getData().settings.batteryReserve).toBe(20);
  });

  it('writes a three-phase-only setting (force charge, HR 1123)', async () => {
    const { mock, inverter } = await threePhase();
    await inverter.setSetting('forceCharge', true);
    expect(mock.writes).toEqual([{ register: 1123, value: 1 }]);
  });

  it('encodes enums and booleans from the catalogue', async () => {
    const { mock, inverter } = await gen3();
    await inverter.setSetting('exportPriority', 'gridFirst');
    await inverter.setSetting('ecoMode', false);
    expect(mock.writes).toEqual([{ register: 311, value: 2 }, { register: 27, value: 0 }]);
    expect(inverter.getData().settings).toMatchObject({ exportPriority: 'gridFirst', ecoMode: false });
  });

  it('quirk: rejects 0 for the inverter charge power percent, which the inverter refuses (GivTCP sends 1)', async () => {
    const { mock, inverter } = await gen3();
    await expect(inverter.setSetting('inverterChargePowerPercent', 0)).rejects.toThrow(RangeError);
    expect(mock.writes).toEqual([]);
  });

  it('throws UnsupportedSettingError for the HR 300 block on a Gen2, which has no acSettingsBlock', async () => {
    const { mock, inverter } = await gen2();
    expect(inverter.capabilities.acSettingsBlock).toBe(false);
    const error = await inverter.setSetting('exportPriority', 'gridFirst').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(UnsupportedSettingError);
    expect(error).toMatchObject({ name: 'UnsupportedSettingError', key: 'exportPriority', model: 'hybrid_gen2', firmware: 920 });
    expect(mock.writes).toEqual([]);
  });

  it('rejects calibration stages the inverter only reports, such as balance', async () => {
    const { mock, inverter } = await gen3();
    // A compile error too (inverter.test-d.ts); forced past the types it is a RangeError.
    await expect(inverter.setSetting('batteryCalibration', 'balance' as never)).rejects.toThrow(RangeError);
    expect(mock.writes).toEqual([]);
  });

  it('refuses read-only and unsafe settings when forced past the types', async () => {
    const { mock, inverter } = await gen3();
    await expect(inverter.setSetting('exportLimit' as never, 5000 as never)).rejects.toThrow('exportLimit is read only');
    await expect(inverter.setSetting('forceOffGrid' as never, true as never)).rejects.toThrow('write it with unsafe_setSetting');
    await expect(inverter.setSetting('notASetting' as never, 1 as never)).rejects.toThrow('unknown setting');
    expect(mock.writes).toEqual([]);
  });

  it('quirk: counts a 0x86 reply as accepted, because Gen1 BPM echoes writes with 0x86 (as in 2.x)', async () => {
    // 0x86 is also what a Modbus error reply to a write looks like, so a real error reply
    // is taken as success and the cache shows the value. Any other error code never matches
    // the write and times out instead.
    const { mock, inverter } = await gen3();
    mock.writeReplyFunctionCode = 0x86;
    await inverter.setSetting('batteryReserve', 20);
    expect(inverter.getData().settings.batteryReserve).toBe(20);
  });

  it('leaves the cache alone when the write is not answered', async () => {
    const { mock, inverter } = await gen3();
    const before = inverter.getData().settings.batteryReserve;
    mock.silent = (request) => request.functionCode === 0x06;
    const data: unknown[] = [];
    inverter.on('data', (snapshot) => data.push(snapshot));

    await expect(inverter.setSetting('batteryReserve', 20)).rejects.toThrow(/timeout/);

    expect(before).not.toBe(20);
    expect(inverter.getData().settings.batteryReserve).toBe(before);
    expect(data).toHaveLength(0);
  });
});

describe('unsafe_setSetting', { timeout: 20_000 }, () => {
  it('writes HR 331 = 1 to force off grid', async () => {
    const { mock, inverter } = await gen3();
    await inverter.unsafe_setSetting('forceOffGrid', true);
    expect(mock.writes).toEqual([{ register: 331, value: 1 }]);
    expect(inverter.getData().settings.forceOffGrid).toBe(true);
  });

  it('lists every unsafe setting\'s risk text in its JSDoc', () => {
    // The JSDoc can't be generated from SETTINGS, so it is copied; this keeps the copy in step.
    const source = readFileSync(new URL('../src/inverter.ts', import.meta.url), 'utf8');
    const start = source.lastIndexOf('/**', source.indexOf('async unsafe_setSetting<'));
    const jsdoc = source
      .slice(start, source.indexOf('*/', start))
      .split('\n')
      .map((line) => line.replace(/^\s*\/?\*+\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    const unsafe = Object.entries(SETTINGS).filter(([, definition]) => 'unsafe' in definition && definition.unsafe);
    expect(unsafe.map(([key]) => key)).toEqual(['batterySelfHeating', 'manualBatteryHeater', 'inverterParallelMode', 'forceOffGrid']);
    for (const [key, definition] of unsafe) {
      const risk = ('risk' in definition ? definition.risk : '').replace(/\s+/g, ' ');
      expect(jsdoc, key).toContain(`\`${key}\`: ${risk}`);
    }
  });
});

describe('other writes', { timeout: 20_000 }, () => {
  it('sets the clock in HR 35–40, with the year as an offset from 2000', async () => {
    const { mock, inverter } = await gen3();
    await inverter.setDateTime(new Date(2026, 10, 20, 13, 45, 30));
    expect(mock.writes).toEqual([
      { register: 35, value: 26 },
      { register: 36, value: 11 },
      { register: 37, value: 20 },
      { register: 38, value: 13 },
      { register: 39, value: 45 },
      { register: 40, value: 30 },
    ]);
  });

  it('reboots by writing HR 163 = 100', async () => {
    const { mock, inverter } = await gen3();
    await inverter.reboot();
    expect(mock.writes).toEqual([{ register: 163, value: 100 }]);
  });

  it('writes any register with unsafe_writeRegister', async () => {
    const { mock, inverter } = await gen3();
    await inverter.unsafe_writeRegister(2071, 5000);
    expect(mock.writes).toEqual([{ register: 2071, value: 5000 }]);
  });
});
