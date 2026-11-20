import { describe, it, expect, vi, afterEach } from 'vitest';
import { PollManager, type PollTiming } from '../src/poll-manager.js';
import { UnsupportedDeviceError } from '../src/errors.js';
import type { InverterSnapshot } from '../src/model/snapshot.js';
import { buildSnapshot } from '../src/snapshot/index.js';
import { capture, contextFor, reference } from './helpers/snapshot-fixtures.js';
import { devicesOf, inverterReads, startMockInverter, type MockDevice, type MockInverter, type MockRequest } from './helpers/mock-inverter.js';

// A real v3 snapshot of the reference unit, for the tests that drive the result handling directly.
const mockSnapshot: InverterSnapshot = buildSnapshot(reference(), contextFor(reference()))!;

describe('PollManager', () => {
  it('throws from getData() if not started', () => {
    // Before start(), there is no cached snapshot.
    // Calling getData() should throw rather than return undefined.
    const pm = new PollManager({
      host: '127.0.0.1',
      pollIntervalMs: 100,
    });
    expect(() => pm.getData()).toThrow('not started');
  });

  it('provides snapshot via getData() after a successful poll', async () => {
    // After start(), poll once, then getData() should return the snapshot.
    // We mock the buildSnapshot call to avoid needing a real inverter.
    const pm = new PollManager({
      host: '127.0.0.1',
      pollIntervalMs: 100,
    });

    // Inject a mock poll function
    let pollCount = 0;
    (pm as any)._executePoll = async () => {
      pollCount++;
      (pm as any)._cache = mockSnapshot;
      (pm as any)._started = true;
    };

    await (pm as any)._executePoll();
    expect(pm.getData()).toBe(mockSnapshot);
  });

  it('emits data event when snapshot is updated', async () => {
    const pm = new PollManager({
      host: '127.0.0.1',
      pollIntervalMs: 50,
    });

    const received: InverterSnapshot[] = [];
    pm.on('data', (s: InverterSnapshot) => received.push(s));

    // Simulate a poll that stores a snapshot and emits data
    (pm as any)._cache = mockSnapshot;
    (pm as any)._started = true;
    pm.emit('data', mockSnapshot);

    expect(received).toHaveLength(1);
    expect(received[0].identity.serialNumber).toBe(mockSnapshot.identity.serialNumber);
  });

  it('increments failure count when poll produces null snapshot', () => {
    // buildSnapshot returns null when sanity check fails.
    // PollManager should track consecutive failures.
    const pm = new PollManager({ host: '127.0.0.1' });
    (pm as any)._started = true; // _handlePollResult ignores results after stop()
    (pm as any)._failCount = 0;
    (pm as any)._handlePollResult(null, null);
    expect((pm as any)._failCount).toBe(1);
  });

  it('resets failure count after a successful poll', () => {
    const pm = new PollManager({ host: '127.0.0.1' });
    (pm as any)._started = true; // _handlePollResult ignores results after stop()
    (pm as any)._failCount = 5;
    (pm as any)._handlePollResult(mockSnapshot, null);
    expect((pm as any)._failCount).toBe(0);
  });

  it('emits lost event after 10 consecutive failures', () => {
    // Python: if failcount >= 10: rebootaddon() — we emit 'lost' instead
    const pm = new PollManager({ host: '127.0.0.1', autoReconnect: false });
    const lostEvents: Error[] = [];
    pm.on('lost', (err: Error) => lostEvents.push(err));

    (pm as any)._started = true; // _handlePollResult ignores results after stop()

    (pm as any)._failCount = 9;
    (pm as any)._handlePollResult(null, new Error('connection lost'));
    expect(lostEvents).toHaveLength(1);
  });

  it('extends EventEmitter', () => {
    const pm = new PollManager({ host: '127.0.0.1' });
    expect(typeof pm.on).toBe('function');
    expect(typeof pm.emit).toBe('function');
  });

  it('exposes start() and stop() methods', () => {
    const pm = new PollManager({ host: '127.0.0.1' });
    expect(typeof pm.start).toBe('function');
    expect(typeof pm.stop).toBe('function');
  });

  describe('auto-reconnect', () => {
    it('does not reconnect when autoReconnect is false', () => {
      const pm = new PollManager({ host: '127.0.0.1', autoReconnect: false });
      const lostEvents: Error[] = [];
      const reconnectingEvents: number[] = [];
      pm.on('lost', (err: Error) => lostEvents.push(err));
      pm.on('reconnecting', (attempt: number) => reconnectingEvents.push(attempt));

      (pm as any)._started = true; // _handlePollResult ignores results after stop()

      (pm as any)._failCount = 9;
      (pm as any)._handlePollResult(null, new Error('connection lost'));

      expect(lostEvents).toHaveLength(1);
      expect(reconnectingEvents).toHaveLength(0);
    });

    it('emits reconnecting events with exponential backoff', async () => {
      const pm = new PollManager({
        host: '127.0.0.1',
        autoReconnect: true,
        reconnectBackoffMs: 10,
        reconnectMaxBackoffMs: 40,
      });

      const events: Array<{ attempt: number; backoff: number }> = [];
      pm.on('reconnecting', (attempt: number, backoff: number) => {
        events.push({ attempt, backoff });
        if (attempt >= 4) pm.stop();
      });

      (pm as any).client.connect = vi.fn().mockRejectedValue(new Error('refused'));
      (pm as any).client.close = vi.fn().mockResolvedValue(undefined);

      (pm as any)._started = true; // _handlePollResult ignores results after stop()

      (pm as any)._failCount = 9;
      (pm as any)._handlePollResult(null, new Error('connection lost'));

      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(4), { timeout: 2000 });

      expect(events[0]).toEqual({ attempt: 1, backoff: 10 });
      expect(events[1]).toEqual({ attempt: 2, backoff: 20 });
      expect(events[2]).toEqual({ attempt: 3, backoff: 40 });
      expect(events[3]).toEqual({ attempt: 4, backoff: 40 });
    });

    it('emits reconnected after successful reconnection', async () => {
      const pm = new PollManager({
        host: '127.0.0.1',
        autoReconnect: true,
        reconnectBackoffMs: 10,
        reconnectMaxBackoffMs: 10,
        pollIntervalMs: 100,
      });

      let reconnected = false;
      pm.on('reconnected', () => { reconnected = true; });

      let connectAttempt = 0;
      (pm as any).client.connect = vi.fn().mockImplementation(async () => {
        connectAttempt++;
        if (connectAttempt < 2) throw new Error('refused');
      });
      (pm as any).client.close = vi.fn().mockResolvedValue(undefined);

      // Mock _executePoll to succeed on reconnect
      (pm as any)._executePoll = vi.fn().mockImplementation(async () => {
        (pm as any)._cache = mockSnapshot;
        (pm as any)._started = true; // _handlePollResult ignores results after stop()
        (pm as any)._failCount = 0;
        (pm as any)._started = true;
      });

      (pm as any)._started = true; // _handlePollResult ignores results after stop()

      (pm as any)._failCount = 9;
      (pm as any)._handlePollResult(null, new Error('connection lost'));

      await vi.waitFor(() => expect(reconnected).toBe(true), { timeout: 2000 });

      expect((pm as any)._pollTimer).not.toBeNull();
      await pm.stop();
    });

    it('stop() aborts an in-progress reconnect loop', async () => {
      const pm = new PollManager({
        host: '127.0.0.1',
        autoReconnect: true,
        reconnectBackoffMs: 50,
        reconnectMaxBackoffMs: 50,
      });

      const events: number[] = [];
      pm.on('reconnecting', (attempt: number) => events.push(attempt));

      (pm as any).client.connect = vi.fn().mockRejectedValue(new Error('refused'));
      (pm as any).client.close = vi.fn().mockResolvedValue(undefined);

      (pm as any)._started = true; // _handlePollResult ignores results after stop()

      (pm as any)._failCount = 9;
      (pm as any)._handlePollResult(null, new Error('connection lost'));

      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 1000 });
      await pm.stop();

      const countAfterStop = events.length;
      await new Promise(r => setTimeout(r, 200));
      expect(events.length).toBe(countAfterStop);
      expect((pm as any)._reconnecting).toBe(false);
    });

    it('resets backoff after successful reconnection', async () => {
      const pm = new PollManager({
        host: '127.0.0.1',
        autoReconnect: true,
        reconnectBackoffMs: 10,
        reconnectMaxBackoffMs: 40,
        pollIntervalMs: 50,
      });

      const allBackoffs: number[] = [];
      pm.on('reconnecting', (_attempt: number, backoff: number) => {
        allBackoffs.push(backoff);
      });

      let connectAttempt = 0;
      (pm as any).client.connect = vi.fn().mockImplementation(async () => {
        connectAttempt++;
        if (connectAttempt <= 2) throw new Error('refused');
      });
      (pm as any).client.close = vi.fn().mockResolvedValue(undefined);
      (pm as any)._executePoll = vi.fn().mockImplementation(async () => {
        (pm as any)._cache = mockSnapshot;
        (pm as any)._started = true; // _handlePollResult ignores results after stop()
        (pm as any)._failCount = 0;
        (pm as any)._started = true;
      });

      (pm as any)._started = true; // _handlePollResult ignores results after stop()

      (pm as any)._failCount = 9;
      (pm as any)._handlePollResult(null, new Error('lost'));

      await vi.waitFor(() => expect((pm as any)._reconnecting).toBe(false), { timeout: 2000 });

      expect(allBackoffs[0]).toBe(10);
      expect(allBackoffs[1]).toBe(20);

      await pm.stop();
    });
  });
});

// ── Against a mock inverter ──────────────────────────────────────────────────

/**
 * Short timeouts, no retries and no inter-read delay. A full refresh still waits out a timeout for
 * each empty battery and meter slot (13 on the reference unit), about a second.
 */
const FAST: Partial<PollTiming> = { requestTimeoutMs: 60, requestRetries: 0, scanRetries: 1, retryDelayMs: 0, interReadDelayMs: 0, frameSpacingMs: 0, pushSoakMs: 30 };

const isInverterRead = (request: MockRequest, functionCode: number, base: number) =>
  request.slaveAddress === 0x11 && request.functionCode === functionCode && request.baseRegister === base;

/** The reference unit: the inverter at 0x11 and its one battery module at 0x32. */
const referenceDevices = () => devicesOf(reference());

describe('PollManager against a mock inverter', { timeout: 20_000 }, () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  async function setUp(
    devices: Map<number, MockDevice>,
    options: { silent?: (request: MockRequest) => boolean; fullRefreshIntervalMs?: number; timing?: Partial<PollTiming> } = {},
  ) {
    const mock = await startMockInverter({ devices, silent: options.silent });
    cleanup.push(() => mock.close());
    const pm = new PollManager({
      host: '127.0.0.1',
      port: mock.port,
      pollIntervalMs: 3_600_000, // the tests poll by hand
      fullRefreshIntervalMs: options.fullRefreshIntervalMs ?? 0, // every poll is a full refresh
      autoReconnect: false,
      timing: { ...FAST, ...options.timing },
    });
    cleanup.push(() => pm.stop());
    const debug: string[] = [];
    pm.on('debug', (message: string) => debug.push(message));
    const poll = () => (pm as unknown as { _executePoll(full?: boolean): Promise<void> })._executePoll(false);
    return { mock, pm, debug, poll };
  }

  describe('blocks', () => {
    it('identifies the reference Gen3 from HR 0/21 and reads the blocks its capabilities ask for', async () => {
      const { mock, pm } = await setUp(referenceDevices());
      await pm.start();
      const snapshot = pm.getData();
      expect(snapshot.layout).toBe('single_phase');
      expect(snapshot.model).toBe('hybrid_gen3');
      expect(snapshot.capabilities).toMatchObject({ tenSlots: true, acSettingsBlock: true, highVoltageBattery: false });
      // HR 0 first (it decides the rest), then the input blocks, then the other holding blocks.
      // No HR 4080: 2.x read its 32-bit battery totals there.
      expect(inverterReads(mock.requests)).toEqual(['HR 0', 'IR 0', 'IR 180', 'IR 240', 'HR 60', 'HR 120', 'HR 180', 'HR 240', 'HR 300']);
      expect(snapshot.settings.batteryReserve).toBe(reference().holding.get(110));
      expect(snapshot.battery.modules).toHaveLength(1);
    });

    it('reads only HR 0 and the input blocks between full refreshes, and no batteries or meters', async () => {
      const { mock, pm, poll } = await setUp(referenceDevices(), { fullRefreshIntervalMs: 3_600_000 });
      await pm.start();
      mock.requests.length = 0;
      await poll();
      expect(mock.requests.map((request) => request.slaveAddress)).toEqual([0x11, 0x11, 0x11]);
      // IR 240 is a full-refresh block.
      expect(inverterReads(mock.requests)).toEqual(['HR 0', 'IR 0', 'IR 180']);
      // Settings from the last full refresh are kept.
      expect(pm.getData().settings.batteryReserve).toBe(reference().holding.get(110));
    });

    it('reads the three-phase blocks and takes the ARM firmware from IR 1327, not HR 21', async () => {
      const registers = capture('hybrid_3ph.log');
      const { mock, pm } = await setUp(new Map([[0x11, { holding: registers.holding, input: registers.input }]]));
      await pm.start();
      const snapshot = pm.getData();
      expect(snapshot.layout).toBe('three_phase');
      expect(snapshot.model).toBe('hybrid_3ph');
      expect(registers.holding.get(21)).toBe(0);
      expect(snapshot.identity.firmware.arm).toBe(registers.input.get(1327));
      expect(inverterReads(mock.requests)).toEqual([
        'HR 0',
        'IR 0', 'IR 180', 'IR 1000', 'IR 1060', 'IR 1120', 'IR 1180', 'IR 1240', 'IR 1300', 'IR 1360',
        'HR 60', 'HR 120', 'HR 240', 'HR 1000', 'HR 1060', 'HR 1120/5',
      ]);
    });

    it('scans every battery module slot, past an empty one (#6)', async () => {
      const devices = referenceDevices();
      devices.set(0x34, { input: reference().batteryModules[0] });
      const { mock, pm } = await setUp(devices);
      await pm.start();
      expect(pm.getData().battery.modules).toHaveLength(2);
      const scanned = mock.requests.filter((request) => request.slaveAddress >= 0x32 && request.slaveAddress <= 0x37);
      expect([...new Set(scanned.map((request) => request.slaveAddress))]).toEqual([0x32, 0x33, 0x34, 0x35, 0x36, 0x37]);
    });
  });

  describe('unsupported devices', () => {
    it.each([
      ['an Energy Management System', 0x5101, 'ems'],
      ['a Gateway', 0x7001, 'gateway'],
      // A device with port 8899 open that isn't a GivEnergy inverter reads all zeros (#23).
      ['an unknown device type code, including 0', 0x0000, 'unknown'],
    ])('refuses %s and closes the connection', async (_name, deviceTypeCode, model) => {
      const { mock, pm } = await setUp(new Map([[0x11, { holding: new Map([[0, deviceTypeCode]]) }]]));
      const error = await pm.start().then(() => null, (err: unknown) => err);
      expect(error).toBeInstanceOf(UnsupportedDeviceError);
      expect(error).toMatchObject({ name: 'UnsupportedDeviceError', model, deviceTypeCode });
      // Refused after HR 0: nothing else was requested.
      expect(inverterReads(mock.requests)).toEqual(['HR 0']);
      await vi.waitFor(() => expect(mock.connections()).toBe(0));
      expect(() => pm.getData()).toThrow('not started');
    });

    it('starts without a snapshot (and without refusing) when HR 0 never arrives', async () => {
      const { pm } = await setUp(referenceDevices(), { silent: () => true });
      await pm.start();
      expect(() => pm.getData()).toThrow('not started');
    });
  });

  describe('model resolution', () => {
    /**
     * Answer the first HR 0 read with `corrupt` patched over the real block; later reads are good.
     * The corrupt reply has the request's shape, so it resolves the request like a real reply.
     */
    async function withCorruptFirstHoldingBlock(corrupt: Record<number, number>) {
      const devices = referenceDevices();
      let first = true;
      const setup = await setUp(devices, {
        silent: (request) => {
          // A single-phase unit doesn't answer the three-phase input blocks.
          if (request.slaveAddress === 0x11 && request.functionCode === 0x04 && request.baseRegister >= 1000) return true;
          if (!first || !isInverterRead(request, 0x03, 0)) return false;
          first = false;
          const values = setup.mock.valuesOf(devices.get(0x11)!, 0x03, 0, 60)!;
          for (const [address, value] of Object.entries(corrupt)) values[Number(address)] = value;
          setImmediate(() => setup.mock.push(0x11, 0x03, 0, values));
          return true;
        },
      });
      return setup;
    }

    it('re-resolves the model until a snapshot passes the sanity check, so a wrong first HR 0 does not stick', async () => {
      // A plausible-looking first block claiming a three-phase Hybrid: this single-phase unit
      // doesn't answer the three-phase sanity register (IR 1128), so no snapshot passes with it.
      const { pm, poll } = await withCorruptFirstHoldingBlock({ 0: 0x4004 });
      await pm.start();
      expect(() => pm.getData()).toThrow('not started');
      await poll();
      expect(pm.getData().model).toBe('hybrid_gen3');
      expect(pm.getData().layout).toBe('single_phase');
    });

    it('does not refuse the device on an HR 0 block whose own sanity registers are corrupt', async () => {
      // Modbus version 99.99 (HR 34) marks the block corrupt; its 0x5101 would otherwise read as an EMS.
      const { pm, poll, debug } = await withCorruptFirstHoldingBlock({ 0: 0x5101, 34: 9999 });
      await pm.start();
      expect(debug).toContain('HR 0 block fails its sanity registers; not resolving the model from it');
      await poll();
      expect(pm.getData().model).toBe('hybrid_gen3');
    });

    it('keeps the model once a snapshot built with it has passed the sanity check', async () => {
      const devices = referenceDevices();
      const { pm, poll } = await setUp(devices);
      await pm.start();
      devices.get(0x11)!.holding!.set(0, 0x4004);
      await poll();
      expect(pm.getData().model).toBe('hybrid_gen3');
    });
  });

  describe('unanswered blocks', () => {
    it('stops requesting HR 300 after three polls without an answer, and turns acSettingsBlock off', async () => {
      const { mock, pm, debug, poll } = await setUp(referenceDevices(), {
        silent: (request) => isInverterRead(request, 0x03, 300),
      });
      await pm.start(); // miss 1
      await poll(); // miss 2
      expect(pm.getData().capabilities.acSettingsBlock).toBe(true);
      await poll(); // miss 3
      expect(mock.requests.filter((request) => isInverterRead(request, 0x03, 300))).toHaveLength(3);

      const snapshot = pm.getData();
      expect(snapshot.capabilities.acSettingsBlock).toBe(false);
      expect('exportPriority' in snapshot.settings).toBe(false);
      expect(debug).toContain('HR 300–359 unanswered 3 polls in a row; no longer requesting it');
      expect(debug).toContain('capabilities turned off: acSettingsBlock');

      // The pause registers are now read on their own, so battery pause stays in the snapshot.
      mock.requests.length = 0;
      await poll();
      expect(inverterReads(mock.requests)).toEqual(['HR 0', 'IR 0', 'IR 180', 'IR 240', 'HR 60', 'HR 120', 'HR 180', 'HR 240', 'HR 318/3']);
      const after = pm.getData();
      expect(after.layout === 'single_phase' && after.schedules.batteryPause?.mode).toBe('off');
    });

    it('turns ten slots and per-slot targets off when HR 240 goes unanswered, falling back to the legacy slots', async () => {
      const { pm, poll } = await setUp(referenceDevices(), {
        silent: (request) => isInverterRead(request, 0x03, 240),
      });
      await pm.start();
      await poll();
      await poll();
      const snapshot = pm.getData();
      expect(snapshot.capabilities).toMatchObject({ tenSlots: false, perSlotTargets: false });
      // Legacy charge slot 2 is HR 31/32, which the reference unit still reports.
      expect(snapshot.schedules.charge.map((slot) => slot.slot)).toEqual([1, 2]);
      expect(snapshot.schedules.charge.every((slot) => slot.targetStateOfCharge === undefined)).toBe(true);
    });

    it('quirk: Gen1 ARM 451 never answers a read of HR 318 but takes the write, so dropping the read keeps pause mode', async () => {
      // Gen1 ARM 451 doesn't answer reads of HR 318 but accepts writes to it (GivTCP #673/#698).
      const registers = capture('hybrid_gen1_arm449.log');
      const { mock, pm, poll } = await setUp(new Map([[0x11, { holding: registers.holding, input: registers.input }]]), {
        silent: (request) => isInverterRead(request, 0x03, 318),
      });
      await pm.start();
      // HR 318 alone: Gen1 rejects any read touching HR 319/320.
      expect(inverterReads(mock.requests)).toContain('HR 318/1');
      await poll();
      await poll();
      await poll();
      expect(mock.requests.filter((request) => isInverterRead(request, 0x03, 318))).toHaveLength(3);
      const snapshot = pm.getData();
      expect(snapshot.capabilities.pauseMode).toBe(true);
      expect(snapshot.layout === 'single_phase' && snapshot.schedules.batteryPause).toBeUndefined();
    });

    it('drops an unanswered IR 240 after three full refreshes without changing any capability', async () => {
      // 2.x never read IR 240; a device that doesn't have it should cost only three slow polls.
      const { mock, pm, poll } = await setUp(referenceDevices(), {
        silent: (request) => isInverterRead(request, 0x04, 240),
      });
      await pm.start();
      const before = pm.getData().capabilities;
      for (let i = 0; i < 3; i++) await poll();
      expect(mock.requests.filter((request) => isInverterRead(request, 0x04, 240))).toHaveLength(3);
      expect(pm.getData().capabilities).toEqual(before);
      expect('combinedGenerationPower' in pm.getData().solar).toBe(false);
    });

    it('keeps a block whose request times out while push data covering it arrives', async () => {
      // The dongle relays its cloud polls in other block shapes; those don't match our request
      // (the shape differs), but they do fill the block.
      const devices = referenceDevices();
      const { mock, pm, poll } = await setUp(devices, {
        silent: (request) => {
          if (!isInverterRead(request, 0x03, 300)) return false;
          setImmediate(() => mock.push(0x11, 0x03, 300, mock.valuesOf(devices.get(0x11)!, 0x03, 300, 40)!));
          return true;
        },
      });
      await pm.start();
      for (let i = 0; i < 3; i++) await poll();
      expect(mock.requests.filter((request) => isInverterRead(request, 0x03, 300))).toHaveLength(4);
      expect(pm.getData().capabilities.acSettingsBlock).toBe(true);
      expect('exportPriority' in pm.getData().settings).toBe(true);
    });

    it('does not count polls where the inverter sent nothing, so a dead link drops no blocks', async () => {
      const { mock, pm, poll } = await setUp(referenceDevices());
      await pm.start();
      const data: InverterSnapshot[] = [];
      pm.on('data', (snapshot: InverterSnapshot) => data.push(snapshot));

      mock.silent = () => true;
      await poll();
      // A dead poll is a failed poll, even though a stale snapshot could be built from the caches.
      expect(data).toHaveLength(0);
      expect((pm as unknown as { _failCount: number })._failCount).toBe(1);
      await poll();
      await poll();

      mock.silent = () => false;
      mock.requests.length = 0;
      await poll();
      expect(data).toHaveLength(1);
      expect(inverterReads(mock.requests)).toContain('HR 300');
      expect(pm.getData().capabilities.acSettingsBlock).toBe(true);
    });

    it('treats a poll as live when push data arrives even though every matched read times out', async () => {
      // Push mode: the inverter streams register data that doesn't match the pending requests.
      const devices = referenceDevices();
      const { mock, pm, poll } = await setUp(devices);
      await pm.start();
      mock.silent = (request) => {
        if (isInverterRead(request, 0x03, 0)) {
          setImmediate(() => mock.push(0x11, 0x03, 0, mock.valuesOf(devices.get(0x11)!, 0x03, 0, 59)!));
        }
        return true;
      };
      const data: InverterSnapshot[] = [];
      pm.on('data', (snapshot: InverterSnapshot) => data.push(snapshot));
      (pm as unknown as { _failCount: number })._failCount = 3;
      await poll();
      expect(data).toHaveLength(1);
      expect((pm as unknown as { _failCount: number })._failCount).toBe(0);
    });
  });

  describe('slow and pushed replies', () => {
    const isRead = (request: MockRequest, slave: number, functionCode: number, base: number) =>
      request.slaveAddress === slave && request.functionCode === functionCode && request.baseRegister === base;
    const count = (mock: MockInverter, slave: number, functionCode: number, base: number) =>
      mock.requests.filter((request) => isRead(request, slave, functionCode, base)).length;

    /** The reference unit plus the Gen2 capture's single-phase meter at 0x01. */
    function devicesWithMeter() {
      const devices = referenceDevices();
      const [meter] = capture('hybrid_gen2_arm920.log').meters!;
      devices.set(0x01, { input: meter.input, product: new Map([[60, 1], [61, 2], [62, 0x4142]]) });
      return devices;
    }

    it('quirk: does not request a block the inverter pushed this poll, which it would not answer', async () => {
      // Seen on a Gen3: IR 0 and IR 180 arrive as push data before they are requested, and the
      // explicit IR 0 request then times out on every attempt (42 s on the real device).
      const devices = referenceDevices();
      const inverter = devices.get(0x11)!;
      const { mock, pm, debug } = await setUp(devices, {
        silent: (request) => {
          if (isRead(request, 0x11, 0x03, 0)) {
            mock.push(0x11, 0x04, 0, mock.valuesOf(inverter, 0x04, 0, 60)!);
            mock.push(0x11, 0x04, 180, mock.valuesOf(inverter, 0x04, 180, 60)!);
          }
          return isRead(request, 0x11, 0x04, 0) || isRead(request, 0x11, 0x04, 180);
        },
      });
      await pm.start();
      expect(count(mock, 0x11, 0x04, 0)).toBe(0);
      expect(count(mock, 0x11, 0x04, 180)).toBe(0);
      expect(debug).toContain('IR 0–59 filled from push data; not requesting it');
      expect(pm.getData().battery.stateOfCharge).toBe(reference().input.get(59));
    });

    it('quirk: takes a reply that arrives after its attempt timed out, instead of retrying', async () => {
      // Seen on a Gen3: meter replies arrive just after the client's timeout, when no request is
      // pending for them, and 2.x sent yet another retry.
      const devices = devicesWithMeter();
      const meter = devices.get(0x01)!;
      let first = true;
      const { mock, pm } = await setUp(devices, {
        // The reply arrives 20 ms after the 60 ms timeout, during the 100 ms before the retry.
        timing: { retryDelayMs: 100 },
        silent: (request) => {
          if (!isRead(request, 0x01, 0x04, 60) || !first) return false;
          first = false;
          setTimeout(() => mock.push(0x01, 0x04, 60, mock.valuesOf(meter, 0x04, 60, 29)!), 80);
          return true;
        },
      });
      await pm.start();
      expect(count(mock, 0x01, 0x04, 60)).toBe(1);
      expect(pm.getData().meters.map((m) => m.slaveAddress)).toEqual([1]);
    });

    it('stops requesting silent meter addresses and battery slots after three full refreshes', async () => {
      const { mock, pm, poll, debug } = await setUp(devicesWithMeter());
      await pm.start();
      await poll();
      await poll();
      // Two attempts (one scan retry) on each of three full refreshes.
      expect(count(mock, 0x02, 0x04, 60)).toBe(6);
      expect(count(mock, 0x33, 0x04, 60)).toBe(6);
      expect(debug).toContain('slave 0x02 IR 60–88 unanswered 3 polls in a row; no longer requesting it');

      mock.requests.length = 0;
      await poll();
      const scanned = [...new Set(mock.requests.filter((request) => request.slaveAddress !== 0x11).map((request) => request.slaveAddress))];
      expect(scanned).toEqual([0x32, 0x01]);
      expect(pm.getData().meters).toHaveLength(1);
      expect(pm.getData().battery.modules).toHaveLength(1);
    });

    it('pipelines the meter scan and matches replies that arrive out of order and in a burst', async () => {
      // Four meters with different phase 1 voltages. Their data replies are held back until all
      // four requests are outstanding, then sent at once in reverse order.
      const devices = referenceDevices();
      const [template] = capture('hybrid_gen2_arm920.log').meters!;
      const volts = [2301, 2302, 2303, 2304];
      volts.forEach((raw, i) => devices.set(i + 1, { input: new Map([...template.input, [60, raw]]), product: new Map() }));
      // Empty battery slots answer (zeros), so the pipeline isn't held up waiting for them.
      for (let slave = 0x33; slave <= 0x37; slave++) devices.set(slave, { input: new Map() });
      const held: MockRequest[] = [];
      const { mock, pm } = await setUp(devices, {
        timing: { requestTimeoutMs: 2000 },
        silent: (request) => {
          const isMeterData = request.functionCode === 0x04 && request.slaveAddress >= 1 && request.slaveAddress <= 4;
          if (!isMeterData) return false;
          held.push(request);
          if (held.length === 4) {
            for (const reply of [...held].reverse()) {
              mock.push(reply.slaveAddress, 0x04, 60, mock.valuesOf(devices.get(reply.slaveAddress)!, 0x04, 60, 29)!);
            }
          }
          return true;
        },
      });
      await pm.start();
      expect(held.map((request) => request.slaveAddress)).toEqual([1, 2, 3, 4]);
      expect(pm.getData().meters.map((meter) => [meter.slaveAddress, meter.voltage[0]])).toEqual([[1, 230.1], [2, 230.2], [3, 230.3], [4, 230.4]]);
      // Each meter was asked once: the burst answered every outstanding request.
      expect(mock.requests.filter((request) => request.functionCode === 0x04 && request.slaveAddress <= 4)).toHaveLength(4);
    });

    it('keeps 250 ms between frames, pipelined or not, and scans one device at a time with a pipeline of 1', async () => {
      const scanGaps = async (scanPipeline: number) => {
        const { mock, pm } = await setUp(referenceDevices(), {
          // Silent devices time out after 600 ms, well over the 250 ms frame spacing.
          timing: { frameSpacingMs: 250, scanPipeline, requestTimeoutMs: 600, scanRetries: 0 },
        });
        await pm.start();
        const times = mock.requests.map((request) => request.receivedAt!);
        const gaps = times.slice(1).map((time, i) => time - times[i]);
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(240);
        // Gaps between the scan reads after 0x32, which are all silent.
        const silentScan = mock.requests.filter((request) => request.slaveAddress !== 0x11 && request.slaveAddress !== 0x32);
        const silentTimes = silentScan.map((request) => request.receivedAt!);
        return silentTimes.slice(1).map((time, i) => time - silentTimes[i]);
      };
      // Pipelined: the silent addresses are asked 250 ms apart, without waiting for each other.
      expect(Math.max(...await scanGaps(8))).toBeLessThan(500);
      // Sequential: each waits for the one before it to time out.
      expect(Math.min(...await scanGaps(1))).toBeGreaterThanOrEqual(590);
    }, 60_000);

    it('keeps a meter whose data arrived as push data before the scan (missing from the first v3 device run)', async () => {
      // The dongle relays its own cloud polls, which read the meters as IR 60–119. When that
      // push arrived before the meter scan, 902610c skipped the request as "filled from push
      // data" after clearing the meter's registers for the scan, so the meter vanished.
      const devices = referenceDevices();
      const meterInput = new Map([2412, 0, 0, 433, 0, 0, 0, 0, 65492, 0, 0].map((value, i) => [60 + i, value]));
      devices.set(0x01, { input: meterInput, product: new Map() });
      const { mock, pm } = await setUp(devices, {
        silent: (request) => {
          if (isRead(request, 0x11, 0x03, 0)) mock.push(0x01, 0x04, 60, mock.valuesOf(devices.get(0x01)!, 0x04, 60, 60)!);
          // The real meter at 0x01 didn't answer its product registers.
          return isRead(request, 0x01, 0x16, 60);
        },
      });
      await pm.start();
      expect(count(mock, 0x01, 0x04, 60)).toBe(0); // filled from push data
      expect(pm.getData().meters).toMatchObject([{ slaveAddress: 1, voltage: [241.2, 0, 0], current: [4.33, 0, 0], activePower: [-44, 0, 0] }]);
    });

    it('quirk: the dongle answers absent meter addresses with zeros, which are neither meters nor asked for product registers', async () => {
      // Seen on the real Gen3: every empty meter address 0x02–0x08 answered IR 60–88 with all
      // zeros (and answered the product registers too). Phase 1 voltage 0 means no meter (2.x),
      // so they aren't meters and their product registers aren't worth a read.
      const devices = devicesWithMeter();
      for (let slave = 2; slave <= 8; slave++) devices.set(slave, { input: new Map(), product: new Map() });
      const { mock, pm } = await setUp(devices);
      await pm.start();
      expect(pm.getData().meters.map((meter) => meter.slaveAddress)).toEqual([1]);
      expect(mock.requests.filter((request) => request.functionCode === 0x16).map((request) => request.slaveAddress)).toEqual([1]);
    });

    it('reads meter product registers once per session, and only for meters that answered', async () => {
      const { mock, pm, poll } = await setUp(devicesWithMeter());
      await pm.start();
      await poll();
      await poll();
      expect(count(mock, 0x01, 0x16, 60)).toBe(1);
      expect(mock.requests.filter((request) => request.functionCode === 0x16 && request.slaveAddress !== 0x01)).toEqual([]);
      expect(pm.getData().meters[0]).toMatchObject({ serialNumber: 0x10002, factoryCode: 'AB' });
    });
  });

  describe('lifecycle and robustness', () => {
    const isRead = (request: MockRequest, slave: number, functionCode: number, base: number) =>
      request.slaveAddress === slave && request.functionCode === functionCode && request.baseRegister === base;

    it('stop() during a reconnect poll leaves no timer running and emits no more data', async () => {
      const mock = await startMockInverter({ devices: referenceDevices() });
      cleanup.push(() => mock.close());
      const pm = new PollManager({
        host: '127.0.0.1', port: mock.port, pollIntervalMs: 50, fullRefreshIntervalMs: 0,
        reconnectBackoffMs: 10, reconnectMaxBackoffMs: 10,
        timing: { ...FAST, pushSoakMs: 300 },
      });
      cleanup.push(() => pm.stop());
      await pm.start();
      const data: unknown[] = [];
      pm.on('data', (snapshot: unknown) => data.push(snapshot));
      let reconnectPoll = false;
      pm.on('reconnecting', () => { reconnectPoll = true; });

      // Drop the link and fail polls until the reconnect loop starts and reconnects.
      (pm as unknown as { _failCount: number })._failCount = 9;
      mock.dropConnections();
      await vi.waitFor(() => expect(reconnectPoll && mock.connections()).toBe(1), { timeout: 5000 });
      // The reconnect's own poll is in its push soak now: stop during it.
      await pm.stop();
      const eventsAtStop = data.length;
      const requestsAtStop = mock.requests.length;

      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(data).toHaveLength(eventsAtStop);
      expect(mock.requests).toHaveLength(requestsAtStop);
      expect((pm as unknown as { _pollTimer: unknown })._pollTimer).toBeNull();
      expect((pm as unknown as { _delays: Set<unknown> })._delays.size).toBe(0);
    });

    it('never drops a block that has answered this session (HR 240 answers once, then goes silent)', async () => {
      const { mock, pm, poll } = await setUp(referenceDevices());
      await pm.start();
      mock.silent = (request) => isRead(request, 0x11, 0x03, 240);
      for (let i = 0; i < 4; i++) await poll();
      expect(mock.requests.filter((request) => isRead(request, 0x11, 0x03, 240))).toHaveLength(5);
      expect(pm.getData().capabilities).toMatchObject({ tenSlots: true, perSlotTargets: true });
    });

    it('keeps a device\'s last good data across one failed scan, and drops it after two', async () => {
      const devices = referenceDevices();
      const [meter] = capture('hybrid_gen2_arm920.log').meters!;
      devices.set(0x01, { input: meter.input, product: new Map() });
      const { mock, pm, poll } = await setUp(devices);
      await pm.start();
      expect(pm.getData().meters).toHaveLength(1);
      mock.silent = (request) => request.slaveAddress === 0x01;
      await poll();
      expect(pm.getData().meters).toHaveLength(1);
      await poll();
      expect(pm.getData().meters).toHaveLength(0);
    });

    it('does not let a throwing listener fail a poll', async () => {
      const { pm, poll, debug } = await setUp(referenceDevices());
      await pm.start();
      let calls = 0;
      pm.on('data', () => {
        calls++;
        throw new Error('listener bug');
      });
      await poll();
      await poll();
      expect(calls).toBe(2);
      expect(debug).toContain("a 'data' listener threw: listener bug");
      expect((pm as unknown as { _failCount: number })._failCount).toBe(0);
    });

    it('emits lost when a later poll finds an unsupported device', async () => {
      // HR 0 doesn't answer during start(), so nothing is resolved; it later reads as an EMS.
      const devices = referenceDevices();
      const { mock, pm, poll } = await setUp(devices, { silent: (request) => isRead(request, 0x11, 0x03, 0) });
      await pm.start();
      const lost: Error[] = [];
      pm.on('lost', (err: Error) => lost.push(err));
      devices.get(0x11)!.holding!.set(0, 0x5101);
      mock.silent = () => false;
      await poll();
      expect(lost).toHaveLength(1);
      expect(lost[0]).toBeInstanceOf(UnsupportedDeviceError);
    });

    it('answers a heartbeat in the middle of a poll and uses the data adapter serial it carries', async () => {
      const { mock, pm } = await setUp(referenceDevices(), {
        silent: (request) => {
          // The data adapter's heartbeat arrives while the poll waits for HR 60.
          if (isRead(request, 0x11, 0x03, 60)) mock.heartbeat('WF9876G543');
          return false;
        },
      });
      await pm.start();
      expect(mock.heartbeatReplies).toEqual(['WF9876G543']);
      const serials = mock.requests.map((request) => request.dataAdapterSerial);
      // Requests before the heartbeat carry the client's placeholder, later ones the real serial.
      expect(serials[0]).toBe('**********');
      expect(serials.at(-1)).toBe('WF9876G543');
      expect(pm.getData().identity.serialNumber).toBeTruthy();
    });
  });

  describe('applyWrite', () => {
    it('updates the holding cache and rebuilds the snapshot without a network read', async () => {
      const { mock, pm } = await setUp(referenceDevices());
      await pm.start();
      const data: InverterSnapshot[] = [];
      pm.on('data', (snapshot: InverterSnapshot) => data.push(snapshot));
      const requestsBefore = mock.requests.length;

      pm.applyWrite(110, 20);

      expect(pm.getData().settings.batteryReserve).toBe(20);
      expect(data).toHaveLength(1);
      expect(data[0].settings.batteryReserve).toBe(20);
      expect(mock.requests).toHaveLength(requestsBefore);
    });

    it('throws before the first snapshot', () => {
      const pm = new PollManager({ host: '127.0.0.1' });
      expect(() => pm.applyWrite(110, 20)).toThrow('not started');
    });
  });
});
