import { describe, expect, expectTypeOf, it } from 'vitest';
import * as library from '../src/index.js';
import type {
  BatteryPauseInput,
  Capabilities,
  DeviceModel,
  DiscoveredDevice,
  GivEnergyInverterOptions,
  InverterEventName,
  InverterEvents,
  InverterIdentity,
  InverterModel,
  InverterSnapshot,
  Layout,
  Meter,
  ModelOf,
  NumberedTimeSlotInput,
  PlantControllerModel,
  PowerFlows,
  SettingDefinition,
  SettingKey,
  Settings,
  SettingsCatalogue,
  SettingWriteValue,
  SinglePhaseModel,
  SinglePhaseSettings,
  SinglePhaseSnapshot,
  SnapshotOf,
  ThreePhaseModel,
  ThreePhaseSettings,
  ThreePhaseSnapshot,
  TimeSlotConfig,
  TimeSlotInput,
  UnsafeSettingKey,
  ValueOf,
  WritableOnBothLayouts,
  WritableSettingKey,
  WriteValueOf,
} from '../src/index.js';

describe('public exports', () => {
  it('exports exactly these runtime values', () => {
    expect(Object.keys(library).sort()).toEqual([
      'GivEnergyInverter',
      'SETTINGS',
      'SinglePhaseInverter',
      'ThreePhaseInverter',
      'UnsupportedDeviceError',
      'UnsupportedSettingError',
      'discover',
      'getLocalSubnet',
      'parseSubnet',
    ]);
  });

  it('exports working classes, functions and the catalogue', () => {
    expect(typeof library.GivEnergyInverter.connect).toBe('function');
    expect(typeof library.GivEnergyInverter.identify).toBe('function');
    expect(library.SinglePhaseInverter.prototype).toBeInstanceOf(library.GivEnergyInverter);
    expect(library.ThreePhaseInverter.prototype).toBeInstanceOf(library.GivEnergyInverter);
    expect(new library.UnsupportedDeviceError('ems', 0x5101)).toBeInstanceOf(Error);
    expect(new library.UnsupportedSettingError('eps', 'hybrid_gen2', 920).name).toBe('UnsupportedSettingError');
    expect(library.SETTINGS.batteryReserve.register).toEqual({ single_phase: 110, three_phase: 1109 });
    expect(library.parseSubnet('192.168.1.50/32')).toEqual(['192.168.1.50']);
    expect(typeof library.discover).toBe('function');
    expect(typeof library.getLocalSubnet).toBe('function');
  });

  it('exports the main types', () => {
    expectTypeOf<SnapshotOf<'single_phase'>>().toEqualTypeOf<SinglePhaseSnapshot>();
    expectTypeOf<SnapshotOf<'three_phase'>>().toEqualTypeOf<ThreePhaseSnapshot>();
    expectTypeOf<InverterSnapshot>().toEqualTypeOf<SinglePhaseSnapshot | ThreePhaseSnapshot>();
    expectTypeOf<ModelOf<'three_phase'>>().toEqualTypeOf<ThreePhaseModel>();
    expectTypeOf<SinglePhaseModel | ThreePhaseModel>().toEqualTypeOf<InverterModel>();
    expectTypeOf<Layout>().toEqualTypeOf<'single_phase' | 'three_phase'>();
    expectTypeOf<Settings<'single_phase'>>().toEqualTypeOf<SinglePhaseSettings>();
    expectTypeOf<Settings<'three_phase'>>().toEqualTypeOf<ThreePhaseSettings>();
    expectTypeOf<'batteryReserve'>().toExtend<SettingKey<'single_phase'> & WritableSettingKey<'three_phase'>>();
    expectTypeOf<'forceOffGrid'>().toExtend<UnsafeSettingKey<'single_phase'>>();
    expectTypeOf<SettingWriteValue<'exportPriority'>>().toEqualTypeOf<'loadFirst' | 'batteryFirst' | 'gridFirst'>();
    expectTypeOf<SettingDefinition['kind']>().toEqualTypeOf<'boolean' | 'percent' | 'integer' | 'enum' | 'time'>();
    expectTypeOf<Capabilities['tenSlots']>().toEqualTypeOf<boolean>();
    expectTypeOf<DiscoveredDevice>().toExtend<InverterIdentity & { host: string }>();
    expectTypeOf<NumberedTimeSlotInput>().toExtend<TimeSlotInput>();
    expectTypeOf<TimeSlotConfig>().toExtend<NumberedTimeSlotInput>();
    expectTypeOf<BatteryPauseInput['mode']>().toEqualTypeOf<'off' | 'charge' | 'discharge' | 'both'>();
    expectTypeOf<GivEnergyInverterOptions['host']>().toEqualTypeOf<string>();
    expectTypeOf<Meter['slaveAddress']>().toEqualTypeOf<number>();
    expectTypeOf<PowerFlows['gridToHouse']>().toEqualTypeOf<number>();
    expectTypeOf<InverterModel>().toExtend<DeviceModel>();
    expectTypeOf<'ems'>().toExtend<DeviceModel>();
    expectTypeOf<'batteryReserve'>().toExtend<WritableOnBothLayouts>();
    expectTypeOf<PlantControllerModel>().toEqualTypeOf<'ems' | 'gateway'>();
    expectTypeOf<SettingsCatalogue>().toEqualTypeOf<typeof library.SETTINGS>();
    expectTypeOf<ValueOf<SettingsCatalogue['exportPriority']>>().toEqualTypeOf<'loadFirst' | 'batteryFirst' | 'gridFirst' | 'unknown'>();
    expectTypeOf<WriteValueOf<SettingsCatalogue['batteryCalibration']>>().toEqualTypeOf<'off' | 'discharge' | 'charge'>();
    expectTypeOf<InverterEventName>().toEqualTypeOf<'data' | 'lost' | 'reconnecting' | 'reconnected' | 'debug'>();
    expectTypeOf<InverterEvents<'three_phase'>['data']>().toEqualTypeOf<[snapshot: ThreePhaseSnapshot]>();
  });
});
