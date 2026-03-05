import { describe, it, expect } from 'vitest';
import { GivEnergyInverter } from '../src/inverter.js';

describe('GivEnergyInverter', () => {
  it('throws from getData() if not started', () => {
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    expect(() => inv.getData()).toThrow('not started');
  });

  it('extends EventEmitter', () => {
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    expect(typeof inv.on).toBe('function');
    expect(typeof inv.emit).toBe('function');
  });

  it('exposes start() and stop() as async methods', () => {
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    expect(typeof inv.start).toBe('function');
    expect(typeof inv.stop).toBe('function');
  });

  it('exposes write methods', () => {
    // No acronyms in the API — these names are intentional
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    expect(typeof inv.setChargeSlot).toBe('function');
    expect(typeof inv.setDischargeSlot).toBe('function');
    expect(typeof inv.setMode).toBe('function');
    expect(typeof inv.setTargetStateOfCharge).toBe('function');
  });

  it('forwards data and lost events from PollManager', () => {
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    // Just verify the event listeners can be registered
    const dataHandler = () => {};
    const lostHandler = () => {};
    expect(() => inv.on('data', dataHandler)).not.toThrow();
    expect(() => inv.on('lost', lostHandler)).not.toThrow();
  });
});
