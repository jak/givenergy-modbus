import { describe, expect, it } from 'vitest';
import { SETTINGS, isSupported, registerFor } from '../src/catalogue/index.js';
import { decodeSetting, encodeSetting } from '../src/catalogue/codec.js';
import type { SettingDefinition } from '../src/catalogue/types.js';
import type { Capabilities } from '../src/model/capabilities.js';
import type { Layout } from '../src/model/models.js';

const entries = Object.entries(SETTINGS) as [keyof typeof SETTINGS, SettingDefinition][];
const layouts: Layout[] = ['single_phase', 'three_phase'];

/** Holding-register block bases read on a full refresh. Each block covers 60 registers from its base. */
const POLLED_HOLDING_BASES: Record<Layout, number[]> = {
  single_phase: [0, 60, 120, 180, 240, 300],
  three_phase: [0, 60, 120, 1000, 1060, 1120],
};

const noCapabilities: Capabilities = {
  tenSlots: false,
  perSlotTargets: false,
  pauseMode: false,
  pauseWindow: false,
  acSettingsBlock: false,
  highVoltageBattery: false,
  smartLoad: false,
};
const withAcSettingsBlock: Capabilities = { ...noCapabilities, acSettingsBlock: true };

describe.each(entries)('%s', (key, definition) => {
  it('has a one-sentence description', () => {
    expect(definition.description).toMatch(/^[A-Z].*\.$/);
    expect(definition.description.slice(0, -1)).not.toMatch(/\.\s/);
  });

  it('exists on at least one layout', () => {
    expect(layouts.some((layout) => registerFor(key, layout) !== undefined)).toBe(true);
  });

  it.each(layouts)('sits inside a polled holding block on %s', (layout) => {
    const register = registerFor(key, layout);
    if (register === undefined) return;
    const bases = POLLED_HOLDING_BASES[layout];
    expect(bases.some((base) => register >= base && register < base + 60)).toBe(true);
  });

  it('has a risk text when it is unsafe', () => {
    if (definition.unsafe) expect(definition.risk).toBeTruthy();
    else expect(definition.risk).toBeUndefined();
  });

  it('round-trips encode and decode', () => {
    for (const value of sampleValues(definition)) {
      const raw = encodeSetting(definition, value as never);
      expect(decodeSetting(definition, raw)).toEqual(value);
    }
  });

  it('only lists writableValues that are also values', () => {
    if (definition.kind !== 'enum' || !definition.writableValues) return;
    for (const value of definition.writableValues) {
      expect(Object.keys(definition.values)).toContain(value);
    }
  });
});

function sampleValues(definition: SettingDefinition): unknown[] {
  switch (definition.kind) {
    case 'boolean':
      return [false, true];
    case 'percent':
    case 'integer': {
      const middle = Math.round((definition.min + definition.max) / 2);
      return [definition.min, middle, definition.max];
    }
    case 'enum':
      return definition.writableValues ? [...definition.writableValues] : Object.keys(definition.values);
    case 'time':
      return ['00:00', '12:30', '23:59'];
  }
}

describe('registers', () => {
  it.each(layouts)('are unique within %s', (layout) => {
    const seen = new Map<number, string>();
    for (const [key] of entries) {
      const register = registerFor(key, layout);
      if (register === undefined) continue;
      expect(seen.get(register), `${key} shares HR ${register}`).toBeUndefined();
      seen.set(register, key);
    }
  });

  it('resolves per layout and is undefined for a layout the setting is not on', () => {
    expect(registerFor('ecoMode', 'single_phase')).toBe(27);
    expect(registerFor('ecoMode', 'three_phase')).toBe(27);
    expect(registerFor('batteryReserve', 'single_phase')).toBe(110);
    expect(registerFor('batteryReserve', 'three_phase')).toBe(1109);
    expect(registerFor('dcDischarge', 'three_phase')).toBe(1122);
    expect(registerFor('batteryChargeRate', 'single_phase')).toBe(111);
    expect(registerFor('batteryChargeRate', 'three_phase')).toBeUndefined();
    expect(registerFor('forceCharge', 'single_phase')).toBeUndefined();
    expect(registerFor('forceCharge', 'three_phase')).toBe(1123);
  });
});

describe('app names match section 1 of website/register-map.md', () => {
  const expected: Partial<Record<keyof typeof SETTINGS, string>> = {
    acChargeUpperLimitEnabled: 'Enable AC Charge Upper % Limit', // HR 20
    ecoMode: 'Enable Eco Mode', // HR 27
    batteryCalibration: 'Battery Calibration', // HR 29
    inverterMaxOutputPercent: 'Inverter Max Output Active Power Percent', // HR 50
    dcDischarge: 'Enable DC Discharge', // HR 59
    acCharge: 'AC Charge Enable', // HR 96
    batteryReserve: 'Battery Reserve % Limit', // HR 110
    batteryChargeRate: 'Battery Charge Rate', // HR 111
    batteryDischargeRate: 'Battery Discharge Rate', // HR 112
    batteryCutoff: 'Battery Cutoff % Limit', // HR 114
    // The map labels the global limit "(global)" to tell it apart from the per-slot "Upper SOC % Limit".
    acChargeUpperLimit: 'AC Charge Upper % Limit (global)', // HR 116
    realTimeControl: 'Real-Time Control', // HR 166
    exportPriority: 'Export Power Priority', // HR 311
    inverterChargePowerPercent: 'Inverter Charge Power Percentage', // HR 313
    inverterDischargePowerPercent: 'Inverter Discharge Power Percentage', // HR 314
    eps: 'Enable EPS', // HR 317
    batterySelfHeating: 'Enable Battery Self-Heating', // HR 104
    manualBatteryHeater: 'Enable Manual Battery Heater', // HR 172
    inverterParallelMode: 'Enable Inverter Parallel Mode', // HR 199
    forceOffGrid: 'Force Off Grid', // HR 331
  };

  it.each(entries)('%s', (key, definition) => {
    expect(definition.appName).toBe(expected[key]);
  });
});

describe('gating', () => {
  it('hides HR 313 on single-phase without the HR 300 block', () => {
    expect(isSupported('inverterChargePowerPercent', 'single_phase', noCapabilities)).toBe(false);
    expect(isSupported('inverterChargePowerPercent', 'single_phase', withAcSettingsBlock)).toBe(true);
  });

  it('shows HR 1110 on three-phase, where acSettingsBlock is always false', () => {
    expect(isSupported('inverterChargePowerPercent', 'three_phase', noCapabilities)).toBe(true);
    expect(isSupported('inverterDischargePowerPercent', 'three_phase', noCapabilities)).toBe(true);
  });

  it('gates every single-phase HR 300 block entry on acSettingsBlock', () => {
    for (const key of ['exportPriority', 'eps', 'forceOffGrid', 'inverterDischargePowerPercent'] as const) {
      expect(isSupported(key, 'single_phase', noCapabilities)).toBe(false);
      expect(isSupported(key, 'single_phase', withAcSettingsBlock)).toBe(true);
    }
  });

  it('treats ungated settings as supported, and settings off the layout as unsupported', () => {
    expect(isSupported('ecoMode', 'single_phase', noCapabilities)).toBe(true);
    expect(isSupported('forceCharge', 'single_phase', withAcSettingsBlock)).toBe(false);
  });
});

describe('quirks', () => {
  it('rejects 0 for inverter charge power percent (the inverter refuses it)', () => {
    expect(() => encodeSetting(SETTINGS.inverterChargePowerPercent, 0)).toThrow(RangeError);
  });

  it('decodes every battery calibration stage but writes only off, discharge and charge', () => {
    expect(decodeSetting(SETTINGS.batteryCalibration, 5)).toBe('balance');
    expect(() => encodeSetting(SETTINGS.batteryCalibration, 'finish' as 'off')).toThrow(RangeError);
  });

  it('marks export limits read only', () => {
    expect(SETTINGS.exportLimit.writable).toBe(false);
    expect(SETTINGS.threePhaseExportLimit.writable).toBe(false);
    expect(SETTINGS.threePhaseExportLimitEnabled.writable).toBe(false);
  });
});
