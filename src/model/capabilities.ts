/**
 * Per-model capabilities, derived from the resolved model and ARM firmware (HR 21).
 * See docs/plans/2026-11-19-v3-research.md section B.
 */
import { hasHighVoltageBattery, type InverterModel } from './models.js';

export interface Capabilities {
  /** Ten charge/discharge slots, HR 240–299 (charge slot 2 at HR 243/244). Research B. */
  tenSlots: boolean;
  /** Per-slot target state of charge on slots in HR 240–299. Research B. */
  perSlotTargets: boolean;
  /** Battery pause mode, HR 318. Research B. */
  pauseMode: boolean;
  /** Battery pause start/end window, HR 319/320. Research B. */
  pauseWindow: boolean;
  /**
   * The HR 300–359 settings block (HR 311, 313, 314, 317), polled as one 60-register read. Research B.
   * The reference Gen3 (ARM 316) answers this block, so it is enabled on `hybrid_gen3`; a timeout on
   * HR 300 at runtime turns it off.
   * Known gap: Gen1 supports HR 313/314 per the research, but they are not exposed, because the
   * HR 300 block poll would touch HR 319/320, which Gen1 rejects.
   */
  acSettingsBlock: boolean;
  /** High-voltage battery stack (battery control unit at 0x70+, modules at 0x50+). Research A/B. */
  highVoltageBattery: boolean;
  /** Smart load, HR 540–573. Never enabled: times out on every model seen. Research B. */
  smartLoad: boolean;
}

const TEN_SLOT_MODELS: ReadonlySet<InverterModel> = new Set<InverterModel>([
  'hybrid_gen4', 'all_in_one', 'all_in_one_hybrid', 'hybrid_hv_gen3',
  'hybrid_3ph', 'ac_3ph', 'all_in_one_commercial',
]);

const PAUSE_MODE_MODELS: ReadonlySet<InverterModel> = new Set<InverterModel>([
  'all_in_one', 'hybrid_gen2', 'hybrid_gen3', 'hybrid_hv_gen3', 'all_in_one_hybrid',
]);

const AC_SETTINGS_BLOCK_MODELS: ReadonlySet<InverterModel> = new Set<InverterModel>([
  'ac', 'all_in_one', 'hybrid_gen3', 'all_in_one_hybrid',
]);

function hasPauseMode(model: InverterModel, armFirmwareVersion: number): boolean {
  if (model === 'ac') return armFirmwareVersion >= 200;
  if (model === 'hybrid_gen1') return armFirmwareVersion >= 187;
  return PAUSE_MODE_MODELS.has(model);
}

export function capabilitiesFor(model: InverterModel, armFirmwareVersion: number): Capabilities {
  const tenSlots = TEN_SLOT_MODELS.has(model) || (model === 'hybrid_gen3' && armFirmwareVersion > 302);
  const pauseMode = hasPauseMode(model, armFirmwareVersion);
  return {
    tenSlots,
    // The research lists per-slot targets for hybrid_3ph and ac_3ph only, not the commercial All in One.
    perSlotTargets: tenSlots && model !== 'all_in_one_commercial',
    pauseMode,
    // AC and Gen1 have pause mode but no window: Gen1 rejects any access touching HR 319/320.
    pauseWindow: pauseMode && model !== 'ac' && model !== 'hybrid_gen1',
    acSettingsBlock: AC_SETTINGS_BLOCK_MODELS.has(model),
    highVoltageBattery: hasHighVoltageBattery(model),
    smartLoad: false,
  };
}
