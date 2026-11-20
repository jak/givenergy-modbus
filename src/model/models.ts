/**
 * Inverter model resolution from HR 0 (device type code) and HR 21 (ARM firmware).
 * See docs/plans/2026-11-19-v3-research.md section A.
 */
export type SinglePhaseModel =
  | 'hybrid_gen1'
  | 'hybrid_gen2'
  | 'hybrid_gen3'
  | 'hybrid_gen3_plus'
  | 'hybrid_gen4'
  | 'hybrid_hv_gen3'
  | 'polar'
  | 'pv'
  | 'ac'
  | 'all_in_one'
  | 'all_in_one_hybrid';
export type ThreePhaseModel = 'hybrid_3ph' | 'ac_3ph' | 'all_in_one_commercial';
/** Plant controllers (Energy Management System, Gateway) are not inverters; this library refuses them. */
export type PlantControllerModel = 'ems' | 'gateway';
export type InverterModel = SinglePhaseModel | ThreePhaseModel;
export type DeviceModel = InverterModel | PlantControllerModel | 'unknown';
export type Layout = 'single_phase' | 'three_phase';

const THREE_PHASE_MODELS: ReadonlySet<DeviceModel> = new Set<DeviceModel>([
  'hybrid_3ph',
  'ac_3ph',
  'all_in_one_commercial',
]);

const HIGH_VOLTAGE_BATTERY_MODELS: ReadonlySet<InverterModel> = new Set<InverterModel>([
  'all_in_one',
  'all_in_one_hybrid',
  'hybrid_hv_gen3',
  'hybrid_3ph',
  'ac_3ph',
  'all_in_one_commercial',
]);

/**
 * Resolve the model from the first two hex digits of the device type code, falling back
 * to the first digit. The 20xx family is shared by Gen1, Gen2 and Gen3 hybrids, so the
 * ARM firmware century disambiguates: 3xx is Gen3, 8xx/9xx is Gen2, anything else Gen1.
 */
export function resolveModel(deviceTypeCode: number, armFirmwareVersion: number): DeviceModel {
  const hex = deviceTypeCode.toString(16).padStart(4, '0');
  switch (hex.slice(0, 2)) {
    case '20': {
      const century = Math.floor(armFirmwareVersion / 100);
      if (century === 3) return 'hybrid_gen3';
      if (century === 8 || century === 9) return 'hybrid_gen2';
      return 'hybrid_gen1';
    }
    case '21': return 'polar';
    case '22': return 'hybrid_gen3_plus';
    case '23': return 'pv';
    // Unrecognised hybrid variants: use the Gen3 layout without model-specific extras.
    case '24': case '25': return 'hybrid_gen3';
    case '40': return 'hybrid_3ph';
    case '41': return 'all_in_one_commercial';
    case '51': return 'ems';
    case '80': return 'all_in_one';
    case '81': return 'hybrid_hv_gen3';
    case '82': return 'all_in_one_hybrid';
    case '83': return 'hybrid_gen4';
  }
  switch (hex[0]) {
    case '3': return 'ac';
    case '5': return 'ems';
    case '6': return 'ac_3ph';
    case '7': return 'gateway';
  }
  return 'unknown';
}

/** Register layout family for a model. */
export function layoutOf(model: InverterModel): Layout {
  return THREE_PHASE_MODELS.has(model) ? 'three_phase' : 'single_phase';
}

export function isPlantController(model: DeviceModel): model is PlantControllerModel {
  return model === 'ems' || model === 'gateway';
}

/**
 * True when the model uses a high-voltage battery stack: a battery control unit
 * at device address 0x70 and up, with battery modules at 0x50 and up.
 */
export function hasHighVoltageBattery(model: InverterModel): boolean {
  return HIGH_VOLTAGE_BATTERY_MODELS.has(model);
}
