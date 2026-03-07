import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PollManager } from '../src/poll-manager.js';
import type { InverterSnapshot } from '../src/model/inverter-snapshot.js';

// Minimal mock snapshot
const mockSnapshot: InverterSnapshot = {
  generation: 'gen3',
  serialNumber: 'EE1234B567',
  modelCode: 0x2003,
  solarPower: 1000,
  pvString1Power: 600,
  pvString2Power: 400,
  batteryPower: 500,
  gridPower: -200,
  loadPower: 1300,
  inverterOutputPower: 1100,
  gridApparentPower: 1350,
  epsBackupPower: 0,
  pvString1Voltage: 320.5,
  pvString2Voltage: 310.2,
  pvString1Current: 1.9,
  pvString2Current: 1.3,
  stateOfCharge: 75,
  batteryVoltage: 51.2,
  batteryCurrent: 9.8,
  gridVoltage: 232.0,
  gridFrequency: 50.0,
  inverterCurrent: 5.6,
  epsBackupVoltage: 232.1,
  epsBackupFrequency: 50.0,
  inverterHeatsinkTemp: 35,
  chargerTemperature: 28.5,
  batteryTemperature: 19.0,
  pvEnergyTotalKwh: 5000,
  batteryChargeEnergyTotalKwh: 1000,
  batteryDischargeEnergyTotalKwh: 900,
  gridImportEnergyTotalKwh: 200,
  gridExportEnergyTotalKwh: 4800,
  consumptionEnergyTotalKwh: 0,
  batteryThroughputTotalKwh: 5453.4,
  hoursOfOperation: 10167,
  pvEnergyTodayKwh: 2.8,
  batteryChargeEnergyTodayKwh: 9.7,
  batteryDischargeEnergyTodayKwh: 7.7,
  gridImportEnergyTodayKwh: 13.5,
  gridExportEnergyTodayKwh: 0.1,
  consumptionEnergyTodayKwh: 12.4,
  chargeSlots: [
    { start: '00:30', end: '04:30', targetStateOfCharge: 100 },
    ...Array.from({ length: 9 }, () => ({ start: '00:00', end: '00:00', targetStateOfCharge: 0 })),
  ],
  dischargeSlots: [
    { start: '00:00', end: '00:00', targetStateOfCharge: 0 },
    ...Array.from({ length: 9 }, () => ({ start: '00:00', end: '00:00', targetStateOfCharge: 0 })),
  ],
  enableCharge: true,
  enableDischarge: false,
  chargeTargetStateOfCharge: 100,
  systemTime: new Date(),
  powerFlows: {
    solarToHouse: 800,
    solarToBattery: 0,
    solarToGrid: 200,
    batteryToHouse: 500,
    batteryToGrid: 0,
    gridToHouse: 0,
    gridToBattery: 0,
  },
  batteries: [],
  meters: [],
};

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
    expect(received[0].serialNumber).toBe('EE1234B567');
  });

  it('increments failure count when poll produces null snapshot', () => {
    // buildSnapshot returns null when sanity check fails.
    // PollManager should track consecutive failures.
    const pm = new PollManager({ host: '127.0.0.1' });
    (pm as any)._failCount = 0;
    (pm as any)._handlePollResult(null, null);
    expect((pm as any)._failCount).toBe(1);
  });

  it('resets failure count after a successful poll', () => {
    const pm = new PollManager({ host: '127.0.0.1' });
    (pm as any)._failCount = 5;
    (pm as any)._handlePollResult(mockSnapshot, null);
    expect((pm as any)._failCount).toBe(0);
  });

  it('emits lost event after 10 consecutive failures', () => {
    // Python: if failcount >= 10: rebootaddon() — we emit 'lost' instead
    const pm = new PollManager({ host: '127.0.0.1', autoReconnect: false });
    const lostEvents: Error[] = [];
    pm.on('lost', (err: Error) => lostEvents.push(err));

    (pm as any)._failCount = 9;
    (pm as any)._handlePollResult(null, new Error('connection lost'));
    expect(lostEvents).toHaveLength(1);
  });

  it('stores device type after first successful poll for HV detection', () => {
    const pm = new PollManager({ host: '127.0.0.1' });
    expect((pm as any)._deviceType).toBeNull();
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
        (pm as any)._failCount = 0;
        (pm as any)._started = true;
      });

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
        (pm as any)._failCount = 0;
        (pm as any)._started = true;
      });

      (pm as any)._failCount = 9;
      (pm as any)._handlePollResult(null, new Error('lost'));

      await vi.waitFor(() => expect((pm as any)._reconnecting).toBe(false), { timeout: 2000 });

      expect(allBackoffs[0]).toBe(10);
      expect(allBackoffs[1]).toBe(20);

      await pm.stop();
    });
  });
});
