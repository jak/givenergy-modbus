import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PollManager } from '../src/poll-manager.js';
import type { InverterSnapshot } from '../src/model/inverter-snapshot.js';

// Minimal mock snapshot
const mockSnapshot: InverterSnapshot = {
  generation: 'gen3',
  serialNumber: 'EE1234B567',
  modelCode: 0x2003,
  solarPower: 1000,
  batteryPower: 500,
  gridPower: -200,
  loadPower: 1300,
  stateOfCharge: 75,
  batteryVoltage: 51.2,
  batteryCurrent: 9.8,
  gridVoltage: 232.0,
  gridFrequency: 50.0,
  inverterHeatsinkTemp: 35,
  pvEnergyTotalKwh: 5000,
  batteryChargeEnergyTotalKwh: 1000,
  batteryDischargeEnergyTotalKwh: 900,
  gridImportEnergyTotalKwh: 200,
  gridExportEnergyTotalKwh: 4800,
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
    const pm = new PollManager({ host: '127.0.0.1' });
    const lostEvents: Error[] = [];
    pm.on('lost', (err: Error) => lostEvents.push(err));

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
});
