/**
 * Schedules group: charge and discharge slots, and (single-phase) battery pause.
 *
 * Slot registers come from src/timeslot-registers.ts (research B):
 * - Ten-slot firmware (`capabilities.tenSlots`): charge slot 1 HR 94/95, slot 2 HR 243/244, slots
 *   3–10 HR 246–269; discharge slot 1 HR 56/57, slot 2 HR 44/45, slots 3–10 HR 276–299. Targets
 *   follow each slot (HR 242, 245, …; HR 272, 275, …) when `capabilities.perSlotTargets`.
 * - Legacy firmware: charge slots HR 94/95 and HR 31/32, discharge slots HR 56/57 and HR 44/45,
 *   no targets. HR 31/32 is not slot 2 on ten-slot firmware (writes there return an error).
 * - Three-phase: slots 1/2 at HR 1113–1116 (charge) and HR 1118–1121 (discharge), slots 3–10 and
 *   their targets in HR 246–299 as on single-phase. No source gives targets for slots 1/2.
 *
 * An unset slot reads `00:00`–`00:00`, and 2400 is normalised to 00:00, as in 2.x. Unlike 2.x,
 * a slot whose start or end register is unread is left out, and so is an unread target,
 * rather than zero-filled.
 */
import type { BatteryPause, SinglePhaseSchedules, ThreePhaseSchedules, TimeSlotConfig } from '../model/snapshot.js';
import { toTimeslot } from '../model/converters.js';
import { slotRegistersFor, type SlotRegisters } from '../timeslot-registers.js';
import {
  readHolding,
  type BuildContext,
  type RegisterCaches,
  type SinglePhaseBuildContext,
  type ThreePhaseBuildContext,
} from './read.js';

/** HR 318: 0 off, 1 pause charging, 2 pause discharging, 3 pause both. */
export const PAUSE_MODES: readonly BatteryPause['mode'][] = ['off', 'charge', 'discharge', 'both'];

/**
 * The slots in `table` whose start and end registers were read, numbered from 1 by position. A
 * target is included when the slot has a target register (`slotRegistersFor` gives one only with
 * `perSlotTargets`) and that register was read.
 */
function slots(registers: RegisterCaches, table: readonly SlotRegisters[]): TimeSlotConfig[] {
  return table.flatMap((slot, position) => {
    const start = readHolding(registers, slot.start);
    const end = readHolding(registers, slot.end);
    if (start === undefined || end === undefined) return [];
    const target = slot.targetStateOfCharge === undefined ? undefined : readHolding(registers, slot.targetStateOfCharge);
    return [{
      slot: position + 1,
      ...toTimeslot(start, end),
      ...(target !== undefined ? { targetStateOfCharge: target } : {}),
    }];
  });
}

/** Battery pause from HR 318–320, read as the app shows it: HR 319 start, HR 320 end. */
function batteryPause(registers: RegisterCaches, context: SinglePhaseBuildContext): BatteryPause | undefined {
  if (!context.capabilities.pauseMode) return undefined;
  const mode = readHolding(registers, 318);
  if (mode === undefined) return undefined;
  // An unnamed value is 'unknown', as the catalogue enums decode them (2.x read it as off).
  const pause: BatteryPause = { mode: PAUSE_MODES[mode] ?? 'unknown' };
  // Gen1 accepts the mode but rejects any access touching HR 319/320 (capabilities.pauseWindow).
  if (!context.capabilities.pauseWindow) return pause;
  const start = readHolding(registers, 319);
  const end = readHolding(registers, 320);
  if (start !== undefined && end !== undefined) {
    // No swap: 2.x reported HR 320 as the start and HR 319 as the end.
    const window = toTimeslot(start, end);
    pause.start = window.start;
    pause.end = window.end;
  }
  return pause;
}

export function buildSchedules(registers: RegisterCaches, context: SinglePhaseBuildContext): SinglePhaseSchedules;
export function buildSchedules(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseSchedules;
export function buildSchedules(
  registers: RegisterCaches,
  context: BuildContext,
): SinglePhaseSchedules | ThreePhaseSchedules {
  const charge = slots(registers, slotRegistersFor(context.layout, context.capabilities, 'charge'));
  const discharge = slots(registers, slotRegistersFor(context.layout, context.capabilities, 'discharge'));
  if (context.layout === 'three_phase') return { charge, discharge };
  const pause = batteryPause(registers, context);
  return { charge, discharge, ...(pause ? { batteryPause: pause } : {}) };
}
