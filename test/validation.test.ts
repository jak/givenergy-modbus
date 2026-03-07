import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isSanityCheckPassing,
  applyStateOfChargeFallback,
  applyTimeFallback,
  applyEnergyRegisterFallback,
  applyFrequencyScaling,
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

  it('uses reported time when year is not 2000', () => {
    const reported = new Date(2024, 5, 15, 14, 30, 0);
    const result = applyTimeFallback(reported, null);
    expect(result).toBe(reported);
  });

  it('uses cached time when year is 2000 and cache exists', () => {
    // GivEnergy inverters ship with RTC defaulted to year 2000.
    // Year 2000 = inverter hasn't synced time.
    // Python: if GEInv.system_time.year == 2000
    const reported = new Date(2000, 0, 1, 0, 0, 0);
    const cached = new Date(2024, 5, 15, 14, 30, 0);
    const result = applyTimeFallback(reported, cached);
    expect(result).toBe(cached);
  });

  it('uses current local time when year is 2000 and no cache', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 2, 5, 10, 0, 0));
    const reported = new Date(2000, 0, 1, 0, 0, 0);
    const result = applyTimeFallback(reported, null);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(2);
  });
});

describe('applyEnergyRegisterFallback', () => {
  it('uses primary registers when non-zero', () => {
    const result = applyEnergyRegisterFallback(123.4, 567.8, 99.9, 88.8);
    expect(result.charge).toBeCloseTo(123.4);
    expect(result.discharge).toBeCloseTo(567.8);
  });

  it('falls back to secondary when BOTH primaries are zero', () => {
    // Old GivEnergy firmware doesn't populate the BMS energy registers.
    // Secondary registers from the inverter's own metering contain the data.
    // Python: if GEBat[0].e_battery_charge_total == 0 and
    //              GEBat[0].e_battery_discharge_total == 0
    const result = applyEnergyRegisterFallback(0, 0, 99.9, 88.8);
    expect(result.charge).toBeCloseTo(99.9);
    expect(result.discharge).toBeCloseTo(88.8);
  });

  it('uses primary even when only charge is zero', () => {
    // Only fall back when BOTH are zero. A battery that's only ever been
    // charged (charge > 0, discharge = 0) is a valid real-world state.
    const result = applyEnergyRegisterFallback(50.0, 0, 99.9, 88.8);
    expect(result.charge).toBeCloseTo(50.0);
    expect(result.discharge).toBeCloseTo(0);
  });

  it('uses primary even when only discharge is zero', () => {
    const result = applyEnergyRegisterFallback(0, 50.0, 99.9, 88.8);
    expect(result.charge).toBeCloseTo(0);
    expect(result.discharge).toBeCloseTo(50.0);
  });
});

describe('applyFrequencyScaling', () => {
  it('returns 50Hz for standard firmware raw=500 (deci-Hz)', () => {
    // Fixes #7: standard firmware reports 500 (deci-Hz).
    // toDeci first → 50.0, then 50 <= 100 → no further scaling → 50Hz.
    // GivTCP: f_ac1 already has deci applied, then checks > 100.
    expect(applyFrequencyScaling(500)).toBeCloseTo(50);
  });

  it('returns 50Hz for old firmware raw=5000 (centi-Hz)', () => {
    // Fixes #7: old firmware reports 5000 (centi-Hz).
    // toDeci first → 500.0, then 500 > 100 → /10 → 50Hz.
    expect(applyFrequencyScaling(5000)).toBeCloseTo(50);
  });

  it('returns 60Hz for 60Hz grid (raw=600)', () => {
    expect(applyFrequencyScaling(600)).toBeCloseTo(60);
  });

  it('handles boundary: raw=1000 → toDeci=100 → no extra scaling → 100Hz-ish left alone', () => {
    // 1000 → toDeci → 100.0, 100 <= 100 → 100.0
    expect(applyFrequencyScaling(1000)).toBeCloseTo(100);
  });

  it('handles zero gracefully', () => {
    expect(applyFrequencyScaling(0)).toBe(0);
  });
});
