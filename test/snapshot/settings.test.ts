import { describe, expect, it } from 'vitest';
import { buildSettings } from '../../src/snapshot/settings.js';
import {
  capture,
  contextFor,
  INVERTER_CAPTURES,
  reference,
  registersOf,
  singlePhaseContextFor,
  threePhaseContextFor,
} from '../helpers/snapshot-fixtures.js';
import { buildForLayout } from '../../src/snapshot/read.js';

describe('buildSettings on the Gen3 reference unit', () => {
  const registers = reference();
  const settings = buildSettings(registers, singlePhaseContextFor(registers));

  it('matches every setting in website/register-map.md section 1', () => {
    expect(settings).toEqual({
      acChargeUpperLimitEnabled: false, // HR 20 "Enable AC Charge Upper % Limit": off
      ecoMode: true, // HR 27 "Enable Eco Mode": on
      batteryCalibration: 'off', // HR 29 "Battery Calibration": Stop
      inverterMaxOutputPercent: 100, // HR 50: 100 %
      dcDischarge: false, // HR 59 "Enable DC Discharge": off
      acCharge: true, // HR 96 "AC Charge Enable": on
      batteryReserve: 4, // HR 110: 4 %
      batteryChargeRate: 50, // HR 111: 50
      batteryDischargeRate: 50, // HR 112: 50
      batteryCutoff: 4, // HR 114: 4 %
      acChargeUpperLimit: 100, // HR 116 "AC Charge Upper % Limit (global)": 100 %
      realTimeControl: false, // HR 166: off
      exportPriority: 'loadFirst', // HR 311 = 0 "Export Power Priority"
      inverterChargePowerPercent: 100, // HR 313: 100 %
      inverterDischargePowerPercent: 100, // HR 314: 100 %
      eps: true, // HR 317 "Enable EPS": on
      exportLimit: 6000, // HR 26 (not shown in the app)
      batterySelfHeating: false, // HR 104: off
      manualBatteryHeater: false, // HR 172: off
      inverterParallelMode: 0, // HR 199: off
      forceOffGrid: false, // HR 331: off
    });
  });
});

describe('buildSettings gating', () => {
  it('leaves out settings the capabilities do not support, even when their register reads', () => {
    // Gen2 has no HR 300–359 settings block (acSettingsBlock is false).
    const registers = registersOf({ 0: 0x2001, 21: 920, 27: 1, 311: 1, 313: 50, 317: 1, 331: 0 });
    const context = singlePhaseContextFor(registers);
    expect(context.capabilities.acSettingsBlock).toBe(false);
    const settings = buildSettings(registers, context);
    expect('exportPriority' in settings).toBe(false);
    expect('inverterChargePowerPercent' in settings).toBe(false);
    expect('eps' in settings).toBe(false);
    expect('forceOffGrid' in settings).toBe(false);
    expect(settings.ecoMode).toBe(true);
  });

  it('leaves out settings whose register has not been read', () => {
    const registers = registersOf({ 0: 0x2001, 21: 316, 27: 0 });
    const settings = buildSettings(registers, singlePhaseContextFor(registers));
    expect(settings).toEqual({ ecoMode: false });
  });

  it('decodes unnamed enum values as "unknown"', () => {
    const registers = registersOf({ 0: 0x2001, 21: 316, 311: 7 });
    expect(buildSettings(registers, singlePhaseContextFor(registers)).exportPriority).toBe('unknown');
  });
});

describe('buildSettings on three-phase', () => {
  const registers = capture('hybrid_3ph.log');
  const settings = buildSettings(registers, threePhaseContextFor(registers));

  it('reads the three-phase registers: charge/discharge power HR 1110/1108 and the rest', () => {
    expect(settings).toMatchObject({
      inverterChargePowerPercent: 1, // HR 1110
      inverterDischargePowerPercent: 1, // HR 1108
    });
    for (const key of ['forceCharge', 'batteryReserve', 'batteryCutoff', 'acChargeUpperLimit', 'acCharge', 'dcDischarge',
      'threePhaseExportLimit', 'threePhaseExportLimitEnabled'] as const) {
      expect(settings, key).toHaveProperty(key);
    }
  });

  it('has no single-phase-only settings', () => {
    for (const key of ['exportPriority', 'eps', 'batteryChargeRate', 'exportLimit', 'forceOffGrid']) {
      expect(key in settings, key).toBe(false);
    }
  });
});

describe.each(INVERTER_CAPTURES)('buildSettings on capture $name', ({ name, inject }) => {
  it('decodes without throwing, with percentages in range', () => {
    const registers = capture(name, inject);
    const settings = buildForLayout(buildSettings, registers, contextFor(registers));
    for (const [key, value] of Object.entries(settings)) {
      expect(value, key).not.toBeUndefined();
      if (key.endsWith('Percent') || ['batteryReserve', 'batteryCutoff', 'acChargeUpperLimit'].includes(key)) {
        expect(value as number, key).toBeGreaterThanOrEqual(0);
        expect(value as number, key).toBeLessThanOrEqual(100);
      }
    }
  });
});
