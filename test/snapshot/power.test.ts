import { describe, expect, it } from 'vitest';
import { buildEps, buildGrid, buildInverterOutput, buildLoad, buildSolar } from '../../src/snapshot/power.js';
import {
  capture,
  contextFor,
  INVERTER_CAPTURES,
  reference,
  registersOf,
  singlePhaseContextFor,
  threePhaseContextFor,
} from '../helpers/snapshot-fixtures.js';

/**
 * The reference fixture is the full scan at 22:28, a few minutes after the register map's dump
 * (22:25:47), so live values drift from website/register-map.md section 2. The temperatures and
 * today counters were taken from this scan and match it exactly.
 */
describe('power groups on the Gen3 reference unit', () => {
  const registers = reference();
  const context = singlePhaseContextFor(registers);

  it('solar: two strings, string energy today 1.6 and 1.7 kWh (register map)', () => {
    expect(buildSolar(registers, context)).toEqual({
      power: 0, // night: register map "Solar generation 0 W"
      strings: [
        { voltage: 12.1, current: 0, power: 0, energyTodayKwh: 1.6 },
        { voltage: 10, current: 0, power: 0, energyTodayKwh: 1.7 },
      ],
      combinedGenerationPower: 0,
    });
  });

  it('grid: IR 30 is the grid CT, importing', () => {
    expect(buildGrid(registers, context)).toEqual({
      power: -360, // IR 30 = 65176, signed
      voltage: 237.3,
      frequency: 50.09, // IR 13 = 5009
    });
  });

  it('inverter: IR 24 is the inverter terminal, and its temperature matches the register map', () => {
    expect(buildInverterOutput(registers, context)).toEqual({
      outputPower: -49, // IR 24 = 65487: a different node from the grid CT's −360 W
      apparentPower: 733,
      powerFactor: -0.498, // IR 16 = 5020
      heatsinkTemperature: 28.9, // register map "Inverter temperature 28.9 °C"
      current: 0.7,
      terminalCurrent: 3.1,
      positiveBusVoltage: 428,
      negativeBusVoltage: 0,
      highVoltageBusVoltage: 278.5,
    });
  });

  it('eps and load', () => {
    expect(buildEps(registers, context)).toEqual({ power: 0, voltage: 237.5, frequency: 50.13 });
    expect(buildLoad(registers, context)).toEqual({ power: 311 });
  });
});

describe('single-phase quirks', () => {
  const build = (input: Record<number, number>, deviceTypeCode = 0x2001, arm = 316) => {
    const registers = registersOf({ 0: deviceTypeCode, 21: arm }, input);
    const context = singlePhaseContextFor(registers);
    return {
      solar: buildSolar(registers, context),
      grid: buildGrid(registers, context),
      inverter: buildInverterOutput(registers, context),
      eps: buildEps(registers, context),
    };
  };

  it('keeps IR 24 (inverter terminal) and IR 30 (grid CT) apart', () => {
    const { grid, inverter } = build({ 24: 1200, 30: 65536 - 300 });
    expect(grid.power).toBe(-300);
    expect(inverter.outputPower).toBe(1200);
  });

  it('has no PV strings on AC-coupled and All in One models, but keeps their generation power', () => {
    // On these models IR 1/2 and IR 8/9 echo the AC side (the All in One's IR 1 equals IR 5).
    for (const [code, arm] of [[0x3001, 282], [0x8001, 620]]) {
      const { solar } = build({ 1: 2408, 5: 2408, 18: 900, 20: 100 }, code, arm);
      expect(solar.strings).toEqual([]);
      expect(solar.power).toBe(1000);
    }
    // The All in One-HY is a DC hybrid and keeps its strings.
    expect(build({ 18: 900 }, 0x8201, 620).solar.strings).toHaveLength(2);
  });

  it('scales frequency ÷100, or ÷10 on firmware that reports it ×10 smaller (IR 13 and IR 54)', () => {
    expect(build({ 13: 5009, 54: 4999 })).toMatchObject({ grid: { frequency: 50.09 }, eps: { frequency: 49.99 } });
    expect(build({ 13: 500, 54: 600 })).toMatchObject({ grid: { frequency: 50 }, eps: { frequency: 60 } });
  });

  it('reads the heatsink temperature as signed', () => {
    expect(build({ 41: 65536 - 52 }).inverter.heatsinkTemperature).toBe(-5.2);
  });

  it('leaves out combined generation power when IR 247–248 are unread (pre-Gen3)', () => {
    expect(build({}).solar).not.toHaveProperty('combinedGenerationPower');
    expect(build({ 247: 1, 248: 2 }).solar.combinedGenerationPower).toBe(65538);
  });
});

describe('power groups on three-phase (hybrid_3ph capture)', () => {
  const registers = capture('hybrid_3ph.log');
  const context = threePhaseContextFor(registers);

  it('solar: strings from IR 1001–1020 and 1366–1373, zero at night', () => {
    const solar = buildSolar(registers, context);
    expect(solar.power).toBe(0);
    expect(solar.strings).toEqual([
      { voltage: 0, current: 0, power: 0, energyTodayKwh: 0, energyTotalKwh: 0 },
      { voltage: 0, current: 0, power: 0, energyTodayKwh: 0, energyTotalKwh: 0 },
    ]);
  });

  it('grid: net of meter export and import, per-phase voltage and current', () => {
    const grid = buildGrid(registers, context);
    expect(grid.power).toBe(-3); // import IR 1079–1080 = 30 (÷10)
    expect(grid.frequency).toBe(49.98);
    // Quirk: the per-phase grid voltages read about 400 V on this capture, the line-to-line
    // voltage, while the inverter's per-phase output voltages (IR 1094–1096) read about 232 V.
    expect(grid.phases).toEqual([
      { voltage: 401.7, current: 2.8 },
      { voltage: 401.3, current: 2.6 },
      { voltage: 404, current: 2.8 },
    ]);
  });

  it('inverter: per-phase power IR 1091–1093 is signed W, not ÷10, and sums to IR 1069–1070', () => {
    const inverter = buildInverterOutput(registers, context);
    expect(inverter.phases).toEqual([
      { voltage: 231.9, power: 549 },
      { voltage: 231.6, power: 516 },
      { voltage: 233.2, power: 541 },
    ]);
    expect(inverter.outputPower).toBe(1606); // IR 1070 = 16060, int32 ÷10 = 549 + 516 + 541
    expect(inverter).toMatchObject({
      apparentPower: 1885,
      heatsinkTemperature: 44.8,
      boostTemperature: 41,
      buckBoostTemperature: 44.2,
      acChargePower: 0,
      dcBusVoltage: 709.7,
      inverterBusVoltage: 709.3,
    });
  });

  it('load: total from IR 1089–1090; per-phase IR 1083–1085 is not exposed', () => {
    const load = buildLoad(registers, context);
    expect(load).toEqual({ power: 1636 }); // IR 1089–1090 = 16360, ÷10
    // Quirk: research C names IR 1083–1085 per-phase load (signed W), but on this capture they
    // read 0, −536 (65000 signed) and 533 W, which can't add up to the 1636 W total. The data
    // contradicts the name, so `load.phases` doesn't exist.
    const perPhase = [1083, 1084, 1085].map((a) => registers.input.get(a));
    expect(perPhase).toEqual([0, 65000, 533]);
    expect(0 + -536 + 533).not.toBeCloseTo(load.power, -2);
  });

  it('eps: per-phase values from IR 1181–1192, power is their sum', () => {
    expect(buildEps(registers, context)).toEqual({
      power: 0,
      frequency: 49.99,
      phases: [
        { voltage: 231.8, current: 0, power: 0 },
        { voltage: 230.5, current: 0, power: 0 },
        { voltage: 231.1, current: 0, power: 0 },
      ],
    });
  });

  it('reads signed int32 inverter output power', () => {
    const exporting = { ...registers, input: new Map(registers.input).set(1069, 0xffff).set(1070, 65536 - 100) };
    expect(buildInverterOutput(exporting, threePhaseContextFor(exporting)).outputPower).toBe(-10);
  });

  it('has no PV strings on the AC-coupled three-phase model', () => {
    const ac = registersOf({ 0: 0x6001 }, { 1017: 0, 1018: 5000 });
    const solar = buildSolar(ac, threePhaseContextFor(ac));
    expect(solar.strings).toEqual([]);
    expect(solar.power).toBe(500);
  });
});

describe.each(INVERTER_CAPTURES)('power groups on capture $name', ({ name, inject }) => {
  it('decode without throwing and give plausible values', () => {
    const registers = capture(name, inject);
    const context = contextFor(registers);
    const solar = buildSolar(registers, context);
    const grid = buildGrid(registers, context);
    const inverter = buildInverterOutput(registers, context);
    const eps = buildEps(registers, context);
    const load = buildLoad(registers, context);

    expect(solar.power).toBeGreaterThanOrEqual(0);
    expect(solar.power).toBeLessThan(30_000);
    for (const string of solar.strings) expect(string.voltage).toBeLessThan(1000);
    expect(grid.frequency).toBeGreaterThan(45);
    expect(grid.frequency).toBeLessThan(65);
    expect(Math.abs(grid.power)).toBeLessThan(30_000);
    expect(Math.abs(inverter.outputPower)).toBeLessThan(30_000);
    expect(inverter.heatsinkTemperature).toBeGreaterThan(-40);
    expect(inverter.heatsinkTemperature).toBeLessThan(100);
    expect(eps.frequency).toBeGreaterThan(45);
    expect(eps.frequency).toBeLessThan(65);
    expect(load.power).toBeGreaterThanOrEqual(0);
    if ('voltage' in grid) {
      expect(grid.voltage).toBeGreaterThan(200);
      expect(grid.voltage).toBeLessThan(260);
    }
    if ('powerFactor' in inverter) {
      expect(inverter.powerFactor).toBeGreaterThanOrEqual(-1);
      expect(inverter.powerFactor).toBeLessThanOrEqual(1);
    }
  });
});
