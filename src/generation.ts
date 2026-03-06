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
