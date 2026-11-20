import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isSanityCheckPassing,
  applyStateOfChargeFallback,
  applyTimeFallback,
} from '../src/validation.js';

describe('isSanityCheckPassing', () => {
  it('accepts normal data', () => {
    expect(isSanityCheckPassing({
      modbusVersion: 0.4, modbusAddress: 1, userCode: 1, heatsinkTemp: 35,
    })).toBe(true);
  });

  it('rejects modbusVersion > 2', () => {
    // An impossible modbus version indicates garbage register data.
    // GivTCP: float(GEInv.modbus_version) > 2 → use cache
    expect(isSanityCheckPassing({
      modbusVersion: 2.5, modbusAddress: 1, userCode: 1, heatsinkTemp: 35,
    })).toBe(false);
  });

  it('rejects modbusAddress > 100', () => {
    expect(isSanityCheckPassing({
      modbusVersion: 0.4, modbusAddress: 255, userCode: 1, heatsinkTemp: 35,
    })).toBe(false);
  });

  it('rejects userCode > 100', () => {
    expect(isSanityCheckPassing({
      modbusVersion: 0.4, modbusAddress: 1, userCode: 255, heatsinkTemp: 35,
    })).toBe(false);
  });

  it('rejects heatsinkTemp > 100°C', () => {
    // An inverter heatsink at > 100°C would be physically destroying itself.
    // This value indicates corrupt register data, not actual temperature.
    expect(isSanityCheckPassing({
      modbusVersion: 0.4, modbusAddress: 1, userCode: 1, heatsinkTemp: 150,
    })).toBe(false);
  });

  it('accepts heatsinkTemp exactly 100°C (boundary)', () => {
    expect(isSanityCheckPassing({
      modbusVersion: 0.4, modbusAddress: 1, userCode: 1, heatsinkTemp: 100,
    })).toBe(true);
  });
});

describe('applyStateOfChargeFallback', () => {
  it('uses reported SOC when non-zero', () => {
    expect(applyStateOfChargeFallback(85, null, false)).toBe(85);
  });

  it('uses reported SOC when calibrating, even if zero', () => {
    // During battery calibration (soc_force_adjust != 0), the SOC genuinely
    // reaches 0% as part of the discharge calibration cycle. Must accept it.
    expect(applyStateOfChargeFallback(0, 50, true)).toBe(0);
  });

  it('uses previous cached SOC when reported 0 (comms glitch)', () => {
    // Transient communication failures can cause a 0% reading even with
    // a healthy battery. Rather than alarming users or triggering automation,
    // use the last known good value.
    // Python: elif GEInv.battery_percent == 0 and len(multi_output_old) > 0
    expect(applyStateOfChargeFallback(0, 72, false)).toBe(72);
  });

  it('defaults to 1% when 0 with no history', () => {
    // First read after startup with comms issues.
    // Use 1% NOT 0% — 0% could trigger "battery empty" automation rules
    // or emergency charge modes. 1% is a safe sentinel.
    // Python: power_output['SOC'] = 1
    expect(applyStateOfChargeFallback(0, null, false)).toBe(1);
  });

  it('passes through SOC=0 when calibrating with no history', () => {
    expect(applyStateOfChargeFallback(0, null, true)).toBe(0);
  });
});

describe('applyTimeFallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses reported time when valid', () => {
    const result = applyTimeFallback(2024, 6, 15, 14, 30, 0, null);
    expect(result).toEqual(new Date(2024, 5, 15, 14, 30, 0));
  });

  it('uses cached time when year is 2000 and cache exists', () => {
    // GivEnergy inverters ship with RTC defaulted to year 2000.
    // Year 2000 = inverter hasn't synced time.
    const cached = new Date(2024, 5, 15, 14, 30, 0);
    const result = applyTimeFallback(2000, 1, 1, 0, 0, 0, cached);
    expect(result).toBe(cached);
  });

  it('uses current local time when year is 2000 and no cache', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 2, 5, 10, 0, 0));
    const result = applyTimeFallback(2000, 1, 1, 0, 0, 0, null);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(2);
  });

  it('rejects month=13 at year boundary and uses cached time (#9)', () => {
    // At midnight on 31/12, the inverter can report month=13.
    // JavaScript Date silently overflows: new Date(2024, 12, 31) → Jan 31 2025.
    // Must validate raw components before constructing Date.
    const cached = new Date(2024, 11, 31, 23, 59, 0);
    const result = applyTimeFallback(2024, 13, 31, 0, 0, 0, cached);
    expect(result).toBe(cached);
  });

  it('rejects month=0 and uses cached time (#9)', () => {
    // Firmware could report month=0, which Date interprets as December of previous year.
    const cached = new Date(2024, 0, 15, 12, 0, 0);
    const result = applyTimeFallback(2024, 0, 15, 12, 0, 0, cached);
    expect(result).toBe(cached);
  });

  it('rejects invalid day=32 and uses current time when no cache (#9)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 2, 5, 10, 0, 0));
    const result = applyTimeFallback(2024, 6, 32, 14, 0, 0, null);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(2);
  });

  it('rejects invalid hour=25 (#9)', () => {
    const cached = new Date(2024, 5, 15, 14, 30, 0);
    const result = applyTimeFallback(2024, 6, 15, 25, 0, 0, cached);
    expect(result).toBe(cached);
  });

  it('rejects invalid minute=60 (#9)', () => {
    const cached = new Date(2024, 5, 15, 14, 30, 0);
    const result = applyTimeFallback(2024, 6, 15, 14, 60, 0, cached);
    expect(result).toBe(cached);
  });

  it('rejects invalid second=60 (#9)', () => {
    const cached = new Date(2024, 5, 15, 14, 30, 0);
    const result = applyTimeFallback(2024, 6, 15, 14, 30, 60, cached);
    expect(result).toBe(cached);
  });
});
