import { describe, it, expect } from 'vitest';
import { calculatePowerFlows } from '../src/power-flow.js';

describe('calculatePowerFlows', () => {
  it('routes solar to house when solar covers load', () => {
    const flows = calculatePowerFlows({
      solarWatts: 3000, loadWatts: 2000,
      chargeWatts: 500, dischargeWatts: 0,
      importWatts: 0, exportWatts: 500,
    });
    expect(flows.solarToHouse).toBe(2000);
    expect(flows.solarToBattery).toBe(500);
    expect(flows.solarToGrid).toBe(500);
    expect(flows.batteryToHouse).toBe(0);
    expect(flows.gridToHouse).toBe(0);
  });

  it('routes battery to house when solar is insufficient', () => {
    const flows = calculatePowerFlows({
      solarWatts: 500, loadWatts: 2000,
      chargeWatts: 0, dischargeWatts: 1500,
      importWatts: 0, exportWatts: 0,
    });
    expect(flows.solarToHouse).toBe(500);
    expect(flows.batteryToHouse).toBe(1500);
    expect(flows.gridToHouse).toBe(0);
  });

  it('routes grid to house and battery during AC charge (cheap rate)', () => {
    const flows = calculatePowerFlows({
      solarWatts: 0, loadWatts: 500,
      chargeWatts: 3000, dischargeWatts: 0,
      importWatts: 3500, exportWatts: 0,
    });
    expect(flows.gridToHouse).toBe(500);
    expect(flows.gridToBattery).toBe(3000);
    expect(flows.batteryToHouse).toBe(0);
    expect(flows.solarToHouse).toBe(0);
  });

  it('routes battery to grid during forced export', () => {
    const flows = calculatePowerFlows({
      solarWatts: 0, loadWatts: 0,
      chargeWatts: 0, dischargeWatts: 3000,
      importWatts: 0, exportWatts: 3000,
    });
    expect(flows.batteryToGrid).toBe(3000);
    expect(flows.batteryToHouse).toBe(0);
    expect(flows.gridToHouse).toBe(0);
  });

  it('handles night time: grid powers everything, no solar or battery', () => {
    const flows = calculatePowerFlows({
      solarWatts: 0, loadWatts: 1000,
      chargeWatts: 0, dischargeWatts: 0,
      importWatts: 1000, exportWatts: 0,
    });
    expect(flows.gridToHouse).toBe(1000);
    expect(flows.solarToHouse).toBe(0);
    expect(flows.batteryToHouse).toBe(0);
    expect(flows.solarToBattery).toBe(0);
    expect(flows.gridToBattery).toBe(0);
  });

  it('handles all zeros (standby)', () => {
    const flows = calculatePowerFlows({
      solarWatts: 0, loadWatts: 0,
      chargeWatts: 0, dischargeWatts: 0,
      importWatts: 0, exportWatts: 0,
    });
    expect(flows.solarToHouse).toBe(0);
    expect(flows.solarToBattery).toBe(0);
    expect(flows.solarToGrid).toBe(0);
    expect(flows.batteryToHouse).toBe(0);
    expect(flows.batteryToGrid).toBe(0);
    expect(flows.gridToHouse).toBe(0);
    expect(flows.gridToBattery).toBe(0);
  });

  it('handles solar only feeding house (no battery, no grid)', () => {
    const flows = calculatePowerFlows({
      solarWatts: 1500, loadWatts: 1500,
      chargeWatts: 0, dischargeWatts: 0,
      importWatts: 0, exportWatts: 0,
    });
    expect(flows.solarToHouse).toBe(1500);
    expect(flows.solarToBattery).toBe(0);
    expect(flows.solarToGrid).toBe(0);
    expect(flows.batteryToHouse).toBe(0);
    expect(flows.gridToHouse).toBe(0);
  });

  it('all flows are non-negative', () => {
    // Regression check: no flow should ever be negative
    const flows = calculatePowerFlows({
      solarWatts: 500, loadWatts: 3000,
      chargeWatts: 1000, dischargeWatts: 0,
      importWatts: 3500, exportWatts: 0,
    });
    for (const [key, val] of Object.entries(flows)) {
      expect(val, `${key} should be >= 0`).toBeGreaterThanOrEqual(0);
    }
  });
});
