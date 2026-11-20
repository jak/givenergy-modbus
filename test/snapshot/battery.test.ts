import { describe, expect, it } from 'vitest';
import { buildBattery } from '../../src/snapshot/battery.js';
import {
  buildBatteryStacks,
  buildLowVoltageModules,
  isPresentModule,
} from '../../src/snapshot/battery-modules.js';
import type { LowVoltageBatteryModule } from '../../src/model/snapshot.js';
import type { RegisterCaches } from '../../src/snapshot/read.js';
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

const EMPTY_SLOT_TEMPERATURE = 65536 - 2730; // −273.0 °C signed ÷10

describe('buildBattery on the Gen3 reference unit', () => {
  const registers = reference();
  const battery = buildBattery(registers, singlePhaseContextFor(registers));

  it('reads the inverter-side values (website/register-map.md section 2)', () => {
    expect(battery).toMatchObject({
      power: 0, // "Battery power 0 W, Idle"
      voltage: 50.64, // "Battery voltage 50.6 V": IR 50 ÷100
      current: 0,
      stateOfCharge: 5, // "Battery state of charge 5.0 %"
      temperature: 19, // "Battery temperature 19.0 °C"
      chargerTemperature: 27.8, // "Charger temperature 27.8 °C"
    });
    expect(battery).not.toHaveProperty('stacks');
  });

  it('decodes every field of its one LV module (slave 0x32)', () => {
    expect(battery.modules).toEqual([
      {
        kind: 'low_voltage',
        serialNumber: 'DZ0000B000', // placeholder serial
        firmwareVersion: 4009, // "BMS firmware 4009"
        stateOfCharge: 5,
        voltage: 50.112,
        outputVoltage: 49.881,
        current: 0.34, // trusted: Gen3 ARM 316, BMS 4009
        cycleCount: 563,
        cellCount: 16,
        // Register map section 3: "16 cell voltages in mV (3.104–3.144 V)".
        cellVoltages: [
          3.137, 3.141, 3.144, 3.142, 3.133, 3.133, 3.133, 3.136,
          3.137, 3.13, 3.104, 3.131, 3.128, 3.137, 3.133, 3.112,
        ],
        // "IR 76–79 are temperatures ÷10 (18.5–19.5 °C)".
        cellTemperatures: [18.5, 19.5, 18.9, 18.5],
        temperatureMax: 19.5,
        temperatureMin: 18.5,
        mosfetTemperature: 18.3,
        chargeMosfetOn: true, // IR 91 = 0x0610: high byte 6 = bits 1 and 2
        dischargeMosfetOn: true,
        calibratedCapacityAh: 200,
        designCapacityAh: 186, // matches HR 55 = 186 Ah
        remainingCapacityAh: 9.17, // about 5 % of 186 Ah
        designCapacity2Ah: 186,
        statusBytes: [0, 0, 6, 16, 0, 0, 0],
        warningBytes: [0, 0],
        forceDischargeFlag: 0,
        dischargeTotalKwh: 4839.5,
        chargeTotalKwh: 4817,
      } satisfies LowVoltageBatteryModule,
    ]);
  });
});

describe('battery quirks', () => {
  const lvModule = (overrides: Record<number, number> = {}) =>
    new Map(Object.entries({ 98: 4009, 103: 200, 104: 190, 110: 0x4441, ...overrides }).map(([a, v]) => [Number(a), v]));
  const modulesOf = (holding: Record<number, number>, modules: Map<number, number>[]) => {
    const registers: RegisterCaches = { ...registersOf(holding), batteryModules: modules };
    return buildLowVoltageModules(registers, singlePhaseContextFor(registers));
  };

  it('reads temperatures as signed', () => {
    const registers = registersOf({ 0: 0x2001, 21: 316 }, { 55: 65536 - 15, 56: 65536 - 42 });
    expect(buildBattery(registers, singlePhaseContextFor(registers))).toMatchObject({
      chargerTemperature: -1.5,
      temperature: -4.2,
    });
    const [module] = modulesOf({ 0: 0x2001, 21: 316 }, [lvModule({ 76: 65536 - 50, 104: 65536 - 50 })]);
    expect(module.cellTemperatures[0]).toBe(-5);
    expect(module.temperatureMin).toBe(-5);
  });

  it('quirk: skips a ghost battery whose serial is all spaces (0x2020 registers, #3)', () => {
    // Moved from the 2.x snapshot-builder tests. Owners with two batteries saw a third whose
    // serial registers read 0x2020: not zero, but no serial either.
    const ghost = lvModule({ 110: 0x2020, 111: 0x2020, 112: 0x2020, 113: 0x2020, 114: 0x2020 });
    expect(isPresentModule(ghost)).toBe(false);
  });

  it('skips an empty slot: no serial, or temperatures reading −273.0 °C', () => {
    expect(isPresentModule(lvModule())).toBe(true);
    expect(isPresentModule(lvModule({ 110: 0 }))).toBe(false);
    expect(isPresentModule(lvModule({ 103: EMPTY_SLOT_TEMPERATURE, 104: EMPTY_SLOT_TEMPERATURE }))).toBe(false);
    expect(modulesOf({ 0: 0x2001, 21: 316 }, [lvModule({ 103: EMPTY_SLOT_TEMPERATURE }), lvModule()])).toHaveLength(1);
  });

  it('trusts the IR 95 current only on Gen3/AC ARM ≥ 214 with BMS 3020–3999 or ≥ 4009', () => {
    const current = (holding: Record<number, number>, bms: number) =>
      modulesOf(holding, [lvModule({ 95: 65536 - 150, 98: bms })])[0].current;
    expect(current({ 0: 0x2001, 21: 316 }, 4009)).toBe(-1.5);
    expect(current({ 0: 0x2001, 21: 316 }, 3020)).toBe(-1.5);
    expect(current({ 0: 0x3001, 21: 214 }, 3999)).toBe(-1.5); // AC
    expect(current({ 0: 0x2001, 21: 316 }, 4000)).toBeUndefined(); // BMS 4000–4008 excluded
    expect(current({ 0: 0x2001, 21: 316 }, 3019)).toBeUndefined();
    expect(current({ 0: 0x3001, 21: 213 }, 4009)).toBeUndefined(); // ARM too old
    expect(current({ 0: 0x2001, 21: 920 }, 4009)).toBeUndefined(); // Gen2
    expect(current({ 0: 0x2001, 21: 449 }, 4009)).toBeUndefined(); // Gen1
  });

  it('reads capacities as uint32 ÷100 Ah', () => {
    const [module] = modulesOf({ 0: 0x2001, 21: 316 }, [lvModule({ 84: 1, 85: 34, 86: 0, 87: 10200 })]);
    expect(module.calibratedCapacityAh).toBe(655.7);
    expect(module.designCapacityAh).toBe(102);
  });

  it('falls back to the previous state of charge when IR 59 reads 0 outside calibration', () => {
    const registers = registersOf({ 0: 0x2001, 21: 316, 29: 0 }, { 59: 0 });
    const previous = { battery: { stateOfCharge: 42 } } as never;
    const context = { ...singlePhaseContextFor(registers), previous };
    expect(buildBattery(registers, context).stateOfCharge).toBe(42);
    const calibrating = registersOf({ 0: 0x2001, 21: 316, 29: 1 }, { 59: 0 });
    expect(buildBattery(calibrating, { ...singlePhaseContextFor(calibrating), previous }).stateOfCharge).toBe(0);
  });
});

describe('LV captures', () => {
  it('Gen1: two batteries, four empty slots, IR 95 not trusted', () => {
    const registers = capture('hybrid_gen1_arm449.log');
    const battery = buildBattery(registers, singlePhaseContextFor(registers));
    expect(registers.batteryModules).toHaveLength(6);
    expect(battery.modules.map((m) => m.serialNumber)).toHaveLength(2);
    for (const module of battery.modules) {
      expect(module.kind).toBe('low_voltage');
      expect(module).not.toHaveProperty('current');
    }
    expect(battery).not.toHaveProperty('stacks');
  });

  it('AC: two packs, with empty slots echoing the stack totals but no serial', () => {
    const registers = capture('ac_arm282.log');
    // Quirk: slots 0x34–0x36 repeat IR 105/106 with no serial, so they are skipped.
    expect(registers.batteryModules?.[2].get(105)).toBe(22003);
    const battery = buildBattery(registers, singlePhaseContextFor(registers));
    expect(battery.modules).toHaveLength(2);
    expect(battery.modules.every((m) => m.kind === 'low_voltage' && m.current !== undefined)).toBe(true);
  });
});

describe('HV captures', () => {
  it('All in One: one stack of four modules, with 12 temperature sensors each', () => {
    const registers = capture('all_in_one_arm620.log');
    const { stacks, modules } = buildBatteryStacks(registers);
    expect(stacks).toEqual([
      {
        index: 0,
        status: 'discharging',
        moduleCount: 4,
        cellsPerModule: 0, // IR 65 reads 0 on every capture
        cellVoltageCount: 96,
        cellTemperatureCount: 48,
        voltage: 314.6,
        loadVoltage: 314.9,
        current: -1.2, // negative while discharging
        stateOfChargeMax: 42,
        stateOfChargeMin: 40,
        stateOfHealth: 95,
        nominalCapacityAh: 49.5,
        remainingCapacityAh: 19.9,
        cycleCount: 49.5,
        minimumDischargeVoltage: 254.4,
        // IR 103/105 are limits, not live values: 348.5 V is above the 314.6 V stack voltage.
        maximumChargeVoltage: 348.5,
        minimumDischargeCurrent: 49.4,
        maximumChargeCurrent: 25,
        alarmWords: [0, 0, 0, 0, 0, 0],
        energy: { chargeTodayKwh: 15.1, dischargeTodayKwh: 9.2, chargeTotalKwh: 2060.5, dischargeTotalKwh: 1401.4 },
        capacity: { chargeTodayAh: 470, dischargeTodayAh: 292, chargeTotalAh: 60869, dischargeTotalAh: 48698 },
      },
    ]);
    expect(modules).toHaveLength(4);
    expect(modules.map((m) => [m.stack, m.index])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(modules[0].cellVoltages).toHaveLength(24);
    expect(modules[0].cellVoltages[0]).toBe(3.269);
    // 48 sensors ÷ 4 modules: IR 90–101 only.
    expect(modules[0].cellTemperatures).toHaveLength(12);
    expect(modules[0].temperatureMax).toBe(25);
    expect(modules[0].temperatureMin).toBe(24.1);
  });

  it('keeps each device\'s own index when an earlier module or stack did not answer', () => {
    // Indexes come from the device address (stack 0x70 + n, module 0x50 + k), not the position
    // in the cache list: if 0x50 is silent, 0x51 is still module 1.
    const registers = capture('all_in_one_arm620.log');
    const [stack] = registers.batteryStacks!;
    const gapped: RegisterCaches = {
      ...registers,
      batteryStacks: [{ ...stack, index: 1, modules: stack.modules.slice(1) }],
    };
    const { stacks, modules } = buildBatteryStacks(gapped);
    expect(stacks.map((s) => s.index)).toEqual([1]);
    expect(modules.map((m) => [m.stack, m.index])).toEqual([[1, 1], [1, 2], [1, 3]]);
  });

  it('All in One: the module serial at IR 114–118 has a blank first register', () => {
    // Quirk: the All in One's BMUs read IR 110 = "HX" and IR 111–114 = 0, so IR 114–118 give
    // only the last eight characters. Decoded as read.
    const { modules } = buildBatteryStacks(capture('all_in_one_arm620.log'));
    expect(modules[0].serialNumber).toBe('2414G000');
  });

  it('HV Gen3: one stack of three modules; BCU values are not copied onto modules', () => {
    const registers = capture('hybrid_hv_gen3_arm295.log', { 0: 0x8102, 21: 295 });
    const battery = buildBattery(registers, singlePhaseContextFor(registers));
    expect(battery.stacks).toHaveLength(1);
    expect(battery.stacks?.[0]).toMatchObject({ status: 'standby', moduleCount: 3, stateOfChargeMax: 100, stateOfChargeMin: 96 });
    expect(battery.modules).toHaveLength(3);
    expect(battery.modules[0]).toMatchObject({ kind: 'high_voltage', serialNumber: 'HY2446G000' });
    expect(battery.modules[0]).not.toHaveProperty('stateOfCharge');
    expect(battery.voltage).toBe(240.07);
  });

  it('three-phase: one stack of six modules, inverter-side values from IR 1120–1140', () => {
    const registers = capture('hybrid_3ph.log');
    const battery = buildBattery(registers, threePhaseContextFor(registers));
    expect(battery).toMatchObject({
      power: 1704.8, // discharging: IR 1136–1137 = 17048 ÷10, charge 0
      voltage: 472.2, // IR 1133
      batteryManagementSystemVoltage: 471.8, // IR 1131
      current: 3.61, // IR 1140 ÷100; the BCU reads −3.7 A
      stateOfCharge: 92,
      priority: 'load',
    });
    expect(battery.stacks?.[0]).toMatchObject({ moduleCount: 6, voltage: 471.8, current: -3.7, stateOfChargeMax: 92 });
    expect(battery.modules).toHaveLength(6);
  });
});

describe.each(INVERTER_CAPTURES)('buildBattery on capture $name', ({ name, inject }) => {
  it('decodes without throwing and gives plausible values', () => {
    const registers = capture(name, inject);
    const context = contextFor(registers);
    const battery = buildForLayout(buildBattery, registers, context);
    expect(battery.stateOfCharge).toBeGreaterThanOrEqual(0);
    expect(battery.stateOfCharge).toBeLessThanOrEqual(100);
    expect(battery.voltage).toBeGreaterThan(40);
    expect(battery.voltage).toBeLessThan(600);
    expect(battery.modules.length).toBeGreaterThan(0);
    if (context.capabilities.highVoltageBattery) expect(battery.stacks?.length).toBeGreaterThan(0);
    for (const module of battery.modules) {
      expect(module.serialNumber).not.toBe('');
      expect(module.temperatureMax).toBeGreaterThanOrEqual(module.temperatureMin);
      expect(module.temperatureMin).toBeGreaterThan(-30);
      expect(module.temperatureMax).toBeLessThan(60);
      for (const voltage of module.cellVoltages) {
        expect(voltage).toBeGreaterThan(2.5);
        expect(voltage).toBeLessThan(4);
      }
    }
  });
});
