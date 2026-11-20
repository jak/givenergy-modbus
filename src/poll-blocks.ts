/**
 * The register blocks the poll manager reads from the inverter (device address 0x11), derived
 * from the layout and capabilities. See docs/plans/2026-11-19-v3-research.md section B.
 *
 * - A request reads at most 60 registers. Single-phase blocks start on multiples of 60; the
 *   three-phase blocks start at HR/IR 1000, 1060, … as GivTCP reads them.
 * - HR 4080–4139 (2.x's 32-bit battery totals) is not read: those are write-only seed registers.
 * - Single-phase HR 180 is read only for HR 199 (inverter parallel mode); its HR 180 battery total
 *   is not used.
 */
import type { Capabilities } from './model/capabilities.js';
import type { Layout } from './model/models.js';

export interface RegisterBlock {
  base: number;
  count: number;
}

const block = (base: number, count = 60): RegisterBlock => ({ base, count });

/** Whether `register` is one of the registers `registerBlock` reads. */
export function blockCovers(registerBlock: RegisterBlock, register: number): boolean {
  return register >= registerBlock.base && register < registerBlock.base + registerBlock.count;
}

/**
 * Holding blocks for one poll, in request order. A fast poll reads only what changes often or
 * identifies the inverter; a full refresh (`full`) adds the settings and slot blocks.
 */
export function holdingBlocksFor(layout: Layout, capabilities: Capabilities, full: boolean): RegisterBlock[] {
  if (layout === 'three_phase') {
    // Three-phase settings and slots 1/2 are in HR 1000–1124, read every poll as in 2.x.
    const threePhase = [block(1000), block(1060), block(1120, 5)];
    return full ? [block(0), block(60), block(120), block(240), ...threePhase] : [block(0), ...threePhase];
  }
  if (!full) return [block(0)];
  return [
    block(0),
    block(60),
    block(120),
    block(180),
    ...(capabilities.tenSlots ? [block(240)] : []),
    ...(capabilities.acSettingsBlock ? [block(300)] : []),
    // Without the HR 300 block, read the pause registers on their own, as GivTCP does
    // (modbus_patches.py): HR 318–320 with the pause window, HR 318 alone without it, since
    // Gen1 rejects any read touching HR 319/320.
    ...(capabilities.pauseMode && !capabilities.acSettingsBlock ? [block(318, capabilities.pauseWindow ? 3 : 1)] : []),
  ];
}

/**
 * Input blocks for one poll, in request order. Single-phase IR 240 (combined generation power,
 * IR 247/248) is read on a full refresh only, so a device that never answers it costs at most
 * three slow polls before it is dropped.
 */
export function inputBlocksFor(layout: Layout, full: boolean): RegisterBlock[] {
  if (layout === 'single_phase') return [block(0), block(180), ...(full ? [block(240)] : [])];
  return [block(0), block(180), ...[1000, 1060, 1120, 1180, 1240, 1300, 1360].map((base) => block(base))];
}

/**
 * The capabilities with the blocks the inverter never answered turned off, so the snapshot doesn't
 * expect their registers and the poll stops requesting them.
 * - HR 240 unanswered: no ten slots, and so no per-slot targets (they are in HR 240–299 too).
 * - HR 300 unanswered: no AC settings block. The pause registers are then read on their own.
 *
 * An unanswered pause block (HR 318) changes nothing: Gen1 ARM 451 doesn't answer reads of HR 318
 * but accepts writes to it, so pause mode stays writable; the snapshot just has no battery pause.
 */
export function effectiveCapabilities(
  capabilities: Capabilities,
  unansweredHoldingBases: ReadonlySet<number>,
): Capabilities {
  const effective = { ...capabilities };
  if (unansweredHoldingBases.has(240)) {
    effective.tenSlots = false;
    effective.perSlotTargets = false;
  }
  if (unansweredHoldingBases.has(300)) effective.acSettingsBlock = false;
  return effective;
}
