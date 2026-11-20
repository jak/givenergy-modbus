/**
 * Holding register addresses for charge and discharge timeslots.
 *
 * Slot 1-2 use "legacy" register locations from Gen2 inverters.
 * Slots 2-10 use Gen3 register locations (HR 240-299 block).
 * Gen3 overrides slot 2's legacy location (HR 31/32 → HR 243/244).
 *
 * Each slot has a start time register, end time register, and a
 * target state of charge register.
 *
 * Reference: GivTCP baseinverter.py + commands.py RegisterMap
 */

export interface TimeslotRegisters {
  start: number;
  end: number;
  targetStateOfCharge: number;
}

/** Charge slot registers, indexed 0-9 for slots 1-10 */
export const CHARGE_SLOT_REGISTERS: TimeslotRegisters[] = [
  { start: 94,  end: 95,  targetStateOfCharge: 242 }, // Slot 1 (legacy location, Gen3 SOC)
  { start: 243, end: 244, targetStateOfCharge: 245 }, // Slot 2 (Gen3 overrides legacy HR 31/32)
  { start: 246, end: 247, targetStateOfCharge: 248 }, // Slot 3
  { start: 249, end: 250, targetStateOfCharge: 251 }, // Slot 4
  { start: 252, end: 253, targetStateOfCharge: 254 }, // Slot 5
  { start: 255, end: 256, targetStateOfCharge: 257 }, // Slot 6
  { start: 258, end: 259, targetStateOfCharge: 260 }, // Slot 7
  { start: 261, end: 262, targetStateOfCharge: 263 }, // Slot 8
  { start: 264, end: 265, targetStateOfCharge: 266 }, // Slot 9
  { start: 267, end: 268, targetStateOfCharge: 269 }, // Slot 10
];

/** Discharge slot registers, indexed 0-9 for slots 1-10 */
export const DISCHARGE_SLOT_REGISTERS: TimeslotRegisters[] = [
  { start: 56,  end: 57,  targetStateOfCharge: 272 }, // Slot 1 (legacy location)
  { start: 44,  end: 45,  targetStateOfCharge: 275 }, // Slot 2 (legacy location)
  { start: 276, end: 277, targetStateOfCharge: 278 }, // Slot 3
  { start: 279, end: 280, targetStateOfCharge: 281 }, // Slot 4
  { start: 282, end: 283, targetStateOfCharge: 284 }, // Slot 5
  { start: 285, end: 286, targetStateOfCharge: 287 }, // Slot 6
  { start: 288, end: 289, targetStateOfCharge: 290 }, // Slot 7
  { start: 291, end: 292, targetStateOfCharge: 293 }, // Slot 8
  { start: 294, end: 295, targetStateOfCharge: 296 }, // Slot 9
  { start: 297, end: 298, targetStateOfCharge: 299 }, // Slot 10
];

export interface SimpleTimeslotRegisters {
  start: number;
  end: number;
}

/** Three-phase charge slot registers (2 slots only, no per-slot SOC targets) */
export const THREE_PHASE_CHARGE_SLOT_REGISTERS: SimpleTimeslotRegisters[] = [
  { start: 1113, end: 1114 }, // Slot 1
  { start: 1115, end: 1116 }, // Slot 2
];

/** Three-phase discharge slot registers (2 slots only) */
export const THREE_PHASE_DISCHARGE_SLOT_REGISTERS: SimpleTimeslotRegisters[] = [
  { start: 1118, end: 1119 }, // Slot 1
  { start: 1120, end: 1121 }, // Slot 2
];

/**
 * Legacy charge slot 2, on single-phase firmware without ten slots. On ten-slot firmware slot 2
 * is HR 243/244, and writes to HR 31/32 return an error.
 */
export const LEGACY_CHARGE_SLOT_2: SimpleTimeslotRegisters = { start: 31, end: 32 };

/** A slot's registers; `targetStateOfCharge` only where the slot's target can be read and written. */
export interface SlotRegisters extends SimpleTimeslotRegisters {
  targetStateOfCharge?: number;
}

/**
 * The charge or discharge slots a model has, slot 1 first (research B):
 * - Single-phase with ten slots: CHARGE/DISCHARGE_SLOT_REGISTERS. Otherwise two slots: charge
 *   HR 94/95 and HR 31/32, discharge HR 56/57 and HR 44/45.
 * - Three-phase: slots 1/2 at HR 1113–1116 (charge) and HR 1118–1121 (discharge), with no target
 *   register; with ten slots, slots 3–10 as single-phase.
 * Targets are included only with `perSlotTargets`.
 */
export function slotRegistersFor(
  layout: 'single_phase' | 'three_phase',
  capabilities: { tenSlots: boolean; perSlotTargets: boolean },
  kind: 'charge' | 'discharge',
): SlotRegisters[] {
  const tenSlotTable = kind === 'charge' ? CHARGE_SLOT_REGISTERS : DISCHARGE_SLOT_REGISTERS;
  const withTargets = (table: readonly SlotRegisters[]) =>
    table.map(({ start, end, targetStateOfCharge }) =>
      capabilities.perSlotTargets && targetStateOfCharge !== undefined ? { start, end, targetStateOfCharge } : { start, end });
  if (layout === 'three_phase') {
    const firstTwo = kind === 'charge' ? THREE_PHASE_CHARGE_SLOT_REGISTERS : THREE_PHASE_DISCHARGE_SLOT_REGISTERS;
    return [...firstTwo.map(({ start, end }) => ({ start, end })), ...(capabilities.tenSlots ? withTargets(tenSlotTable.slice(2)) : [])];
  }
  if (capabilities.tenSlots) return withTargets(tenSlotTable);
  // Two-slot firmware has no per-slot targets.
  const twoSlots = kind === 'charge' ? [CHARGE_SLOT_REGISTERS[0], LEGACY_CHARGE_SLOT_2] : DISCHARGE_SLOT_REGISTERS.slice(0, 2);
  return twoSlots.map(({ start, end }) => ({ start, end }));
}
