import { expectTypeOf, test } from 'vitest';
import type {
  BatteryModule,
  InverterSnapshot,
  SinglePhaseSnapshot,
  ThreePhase,
  ThreePhaseSnapshot,
  TimeSlotConfig,
} from '../src/model/snapshot.js';
import type { SinglePhaseSettings, ThreePhaseSettings } from '../src/catalogue/index.js';
import type { SinglePhaseModel, ThreePhaseModel } from '../src/model/models.js';
import { buildSnapshot } from '../src/snapshot/index.js';
import { buildSolar, type SinglePhaseSolarPower, type ThreePhaseSolarPower } from '../src/snapshot/power.js';
import { buildForLayout } from '../src/snapshot/read.js';
import type {
  BuildContext,
  RegisterCaches,
  SinglePhaseBuildContext,
  ThreePhaseBuildContext,
} from '../src/snapshot/index.js';

declare const snapshot: InverterSnapshot;
declare const batteryModule: BatteryModule;
declare const registers: RegisterCaches;
declare const singlePhaseContext: SinglePhaseBuildContext;
declare const threePhaseContext: ThreePhaseBuildContext;
declare const anyContext: BuildContext;

test('layout narrows settings to the layout catalogue', () => {
  if (snapshot.layout === 'three_phase') {
    expectTypeOf(snapshot.settings).toEqualTypeOf<ThreePhaseSettings>();
    expectTypeOf(snapshot.settings.forceCharge).toEqualTypeOf<boolean>();
  } else {
    expectTypeOf(snapshot.settings).toEqualTypeOf<SinglePhaseSettings>();
    expectTypeOf(snapshot.settings).not.toHaveProperty('forceCharge');
  }
});

test('battery pause exists only on single-phase schedules', () => {
  expectTypeOf<SinglePhaseSnapshot['schedules']>().toHaveProperty('batteryPause');
  expectTypeOf<ThreePhaseSnapshot['schedules']>().not.toHaveProperty('batteryPause');
  // Optional: absent when the model has no pause mode (capabilities.pauseMode).
  expectTypeOf<{}>().toExtend<Pick<SinglePhaseSnapshot['schedules'], 'batteryPause'>>();
  type Pause = NonNullable<SinglePhaseSnapshot['schedules']['batteryPause']>;
  // 'unknown' for an unnamed HR 318 value, as the catalogue enums decode them.
  expectTypeOf<Pause['mode']>().toEqualTypeOf<'off' | 'charge' | 'discharge' | 'both' | 'unknown'>();
  // Gen1 accepts HR 318 but rejects HR 319/320, so the window is optional.
  expectTypeOf<{ mode: 'off' }>().toExtend<Pause>();
});

test('model narrows with layout', () => {
  expectTypeOf<SinglePhaseSnapshot['model']>().toEqualTypeOf<SinglePhaseModel>();
  expectTypeOf<ThreePhaseSnapshot['model']>().toEqualTypeOf<ThreePhaseModel>();
  expectTypeOf<SinglePhaseSnapshot['identity']['model']>().toEqualTypeOf<SinglePhaseModel>();
});

test('gated settings stay optional in the snapshot', () => {
  expectTypeOf<{}>().toExtend<Pick<SinglePhaseSnapshot['settings'], 'exportPriority'>>();
  expectTypeOf<{}>().not.toExtend<Pick<SinglePhaseSnapshot['settings'], 'ecoMode'>>();
});

test('system mode is raw on single-phase and labelled on three-phase', () => {
  expectTypeOf<SinglePhaseSnapshot['status']['systemMode']>().toEqualTypeOf<number>();
  expectTypeOf<ThreePhaseSnapshot['status']['systemMode']>().toEqualTypeOf<'offline' | 'grid_tied'>();
  expectTypeOf<ThreePhaseSnapshot['status']>().toHaveProperty('dcStatus');
  expectTypeOf<SinglePhaseSnapshot['status']>().not.toHaveProperty('dcStatus');
});

test('three-phase groups carry per-phase values', () => {
  expectTypeOf<ThreePhase<number>>().toEqualTypeOf<readonly [number, number, number]>();
  expectTypeOf<ThreePhaseSnapshot['eps']['phases'][0]>().toEqualTypeOf<{ voltage: number; current: number; power: number }>();
  expectTypeOf<ThreePhaseSnapshot['grid']['phases'][2]>().toEqualTypeOf<{ voltage: number; current: number; power: number }>();
  expectTypeOf<ThreePhaseSnapshot['inverter']['phases'][1]>().toHaveProperty('power');
  // IR 1083–1085 are per-phase grid power, not load (research C's name), so load has no phases.
  expectTypeOf<ThreePhaseSnapshot['load']>().not.toHaveProperty('phases');
  expectTypeOf<SinglePhaseSnapshot['grid']>().not.toHaveProperty('phases');
  expectTypeOf<ThreePhaseSnapshot['battery']['priority']>().toEqualTypeOf<'load' | 'battery' | 'grid'>();
  expectTypeOf<SinglePhaseSnapshot['battery']>().not.toHaveProperty('priority');
});

test('the inverter has no power factor: IR 16 fits no decoding on the captures', () => {
  expectTypeOf<SinglePhaseSnapshot['inverter']>().not.toHaveProperty('powerFactor');
  expectTypeOf<ThreePhaseSnapshot['inverter']>().not.toHaveProperty('powerFactor');
});

test('single-phase consumption is optional: it cannot be derived on AC-coupled models', () => {
  expectTypeOf<{ power: number }>().toExtend<SinglePhaseSnapshot['load']>();
  expectTypeOf<{ power: number }>().not.toExtend<ThreePhaseSnapshot['load']>();
});

test('energy fields end in Kwh', () => {
  expectTypeOf<SinglePhaseSnapshot['battery']['energy']>().toHaveProperty('throughputTotalKwh');
  expectTypeOf<SinglePhaseSnapshot['grid']['energy']>().toHaveProperty('importTodayKwh');
  expectTypeOf<SinglePhaseSnapshot['solar']>().toHaveProperty('energyTotalKwh');
});

test('time slot target is optional (present only with capabilities.perSlotTargets)', () => {
  expectTypeOf<{ slot: number; start: string; end: string }>().toExtend<TimeSlotConfig>();
  // The slot number is required: array position doesn't give it when a slot is left out.
  expectTypeOf<{ start: string; end: string }>().not.toExtend<TimeSlotConfig>();
  expectTypeOf<SinglePhaseSnapshot['schedules']['charge']>().toEqualTypeOf<TimeSlotConfig[]>();
});

test('battery modules discriminate on kind', () => {
  if (batteryModule.kind === 'high_voltage') {
    expectTypeOf(batteryModule.stack).toEqualTypeOf<number>();
  } else {
    expectTypeOf(batteryModule).not.toHaveProperty('stack');
  }
});

test('identity enums', () => {
  type Identity = SinglePhaseSnapshot['identity'];
  expectTypeOf<Identity['batteryType']>().toEqualTypeOf<'lithium' | 'lead_acid'>();
  expectTypeOf<Identity['meterType']>().toEqualTypeOf<'ct_or_em418' | 'em115'>();
  expectTypeOf<Identity['usbDevice']>().toEqualTypeOf<'none' | 'wifi' | 'unknown'>();
  expectTypeOf<{}>().toExtend<Pick<Identity, 'ratedPower' | 'batteryMaxPower' | 'certification'>>();
});

test('group builders take a narrowed context; buildForLayout takes the union', () => {
  expectTypeOf(buildSolar(registers, singlePhaseContext)).toEqualTypeOf<SinglePhaseSolarPower>();
  // @ts-expect-error: no overload for the BuildContext union
  buildSolar(registers, anyContext);
  expectTypeOf(buildForLayout(buildSolar, registers, anyContext)).toEqualTypeOf<SinglePhaseSolarPower | ThreePhaseSolarPower>();
});

test('buildSnapshot narrows its return type to the context layout', () => {
  expectTypeOf(buildSnapshot).parameter(0).toEqualTypeOf<RegisterCaches>();
  expectTypeOf(buildSnapshot(registers, singlePhaseContext)).toEqualTypeOf<SinglePhaseSnapshot | null>();
  expectTypeOf(buildSnapshot(registers, threePhaseContext)).toEqualTypeOf<ThreePhaseSnapshot | null>();
  expectTypeOf(buildSnapshot(registers, anyContext)).toEqualTypeOf<InverterSnapshot | null>();
});
