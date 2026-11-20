import { expectTypeOf, test } from 'vitest';
import { GivEnergyInverter, SinglePhaseInverter, ThreePhaseInverter } from '../src/inverter.js';
import type { SinglePhaseSnapshot, ThreePhaseSnapshot } from '../src/model/snapshot.js';
import type { SinglePhaseModel, ThreePhaseModel } from '../src/model/models.js';

declare const single: SinglePhaseInverter;
declare const three: ThreePhaseInverter;

test('connect returns one of the layout classes', () => {
  expectTypeOf(GivEnergyInverter.connect).returns.resolves.toEqualTypeOf<SinglePhaseInverter | ThreePhaseInverter>();
});

test('getData and model follow the layout', () => {
  expectTypeOf(single.getData()).toEqualTypeOf<SinglePhaseSnapshot>();
  expectTypeOf(three.getData()).toEqualTypeOf<ThreePhaseSnapshot>();
  expectTypeOf(single.model).toEqualTypeOf<SinglePhaseModel>();
  expectTypeOf(three.model).toEqualTypeOf<ThreePhaseModel>();
});

test('setSetting accepts writable settings of the layout with their write value types', () => {
  void single.setSetting('batteryReserve', 20);
  void single.setSetting('exportPriority', 'gridFirst');
  void single.setSetting('batteryCalibration', 'discharge');
  void three.setSetting('forceCharge', true);
  // @ts-expect-error a number, not a string
  void single.setSetting('batteryReserve', '20');
});

test('setSetting rejects calibration stages the inverter only reports', () => {
  // @ts-expect-error 'balance' is decoded but never written
  void single.setSetting('batteryCalibration', 'balance');
});

test('setSetting rejects unsafe and read-only settings', () => {
  // @ts-expect-error unsafe: only unsafe_setSetting writes it
  void single.setSetting('forceOffGrid', true);
  // @ts-expect-error read only
  void single.setSetting('exportLimit', 5000);
  // @ts-expect-error read only
  void three.setSetting('threePhaseExportLimit', 5000);
});

test('setSetting rejects settings of the other layout', () => {
  // @ts-expect-error three-phase only
  void single.setSetting('forceCharge', true);
  // @ts-expect-error single-phase only
  void three.setSetting('batteryChargeRate', 1000);
});

test('unsafe_setSetting accepts only unsafe settings', () => {
  void single.unsafe_setSetting('forceOffGrid', true);
  void single.unsafe_setSetting('inverterParallelMode', 0);
  // @ts-expect-error safe settings go through setSetting
  void single.unsafe_setSetting('batteryReserve', 20);
  // @ts-expect-error no unsafe settings on three-phase
  void three.unsafe_setSetting('forceOffGrid', true);
});

test('slot setters take a slot number and config, or a numbered slot from the snapshot', () => {
  void single.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 80 });
  void single.setChargeSlot(single.getData().schedules.charge[0]);
  void three.setDischargeSlot(2, { start: '16:00', end: '19:00' });
  void three.setChargeSlots(three.getData().schedules.charge);
  // @ts-expect-error a slot number needs a config
  void single.setChargeSlot(1);
  // @ts-expect-error a config without a slot number needs one
  void single.setChargeSlot({ start: '00:30', end: '04:30' });
});

test('setBatteryPause is single-phase only and takes only writable modes', () => {
  void single.setBatteryPause({ mode: 'discharge', start: '16:00', end: '19:00' });
  void single.setBatteryPause({ mode: 'off' });
  // @ts-expect-error 'unknown' is decoded but never written
  void single.setBatteryPause({ mode: 'unknown' });
  // @ts-expect-error three-phase has no battery pause
  void three.setBatteryPause({ mode: 'off' });
});

test('setSetting works on the un-narrowed result of connect() for settings on both layouts', async () => {
  const inverter = await GivEnergyInverter.connect({ host: 'x' });
  void inverter.setSetting('batteryReserve', 20); // HR 110 / HR 1109
  void inverter.setSetting('ecoMode', true); // HR 27 on both layouts
  void inverter.setSetting('acCharge', false); // HR 96 / HR 1112
  // @ts-expect-error the value type still follows the key
  void inverter.setSetting('batteryReserve', '20');
  // @ts-expect-error single-phase only: narrow on layout first
  void inverter.setSetting('batteryChargeRate', 1000);
  // @ts-expect-error three-phase only: narrow on layout first
  void inverter.setSetting('forceCharge', true);
  if (inverter.layout === 'three_phase') void inverter.setSetting('forceCharge', true);
  else void inverter.setSetting('batteryChargeRate', 1000);
});
