import { DeviceType } from './model/device-types.js';

export type InverterGeneration = 'gen2' | 'gen3' | 'three_phase';

const PREFIX_MAP: Record<string, InverterGeneration> = {
  CE: 'gen2',
  EE: 'gen3',
  SA: 'three_phase',
};

export function detectGeneration(serialNumber: string): InverterGeneration {
  const prefix = serialNumber.slice(0, 2);
  return PREFIX_MAP[prefix] ?? 'gen2';
}

/** Map DeviceType to InverterGeneration for snapshot discriminant. */
export function modelToGeneration(model: DeviceType): InverterGeneration {
  switch (model) {
    case DeviceType.HYBRID_GEN3:
    case DeviceType.HYBRID_HV_GEN3:
      return 'gen3';
    case DeviceType.HYBRID_3PH:
    case DeviceType.AC_3PH:
      return 'three_phase';
    default:
      return 'gen2';
  }
}
