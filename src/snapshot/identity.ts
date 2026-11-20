/**
 * Identity group: what the inverter is and how it is configured (HR 0–55).
 * Three-phase units keep their firmware versions in IR 1325–1327 and battery type in IR 1121.
 */
import type { Layout, SinglePhaseModel } from '../model/models.js';
import type { Certification, Identity, ThreePhaseIdentity } from '../model/snapshot.js';
import {
  readHolding,
  readInput,
  readText,
  type BuildContext,
  type RegisterCaches,
  type SinglePhaseBuildContext,
  type ThreePhaseBuildContext,
} from './read.js';

/**
 * Rated AC power in W by device type code (4 hex digits), from the external library's
 * `_DTC_RATED_POWER` (GivTCP's table plus the GivEnergy app v4.0.7 model table). Research A.
 */
const RATED_POWER: Readonly<Record<string, number>> = {
  '2001': 5000, '2002': 4600, '2003': 3600,
  '2101': 5000, '2102': 4600, '2103': 3600, '2104': 6000, '2105': 7000, '2106': 8000,
  '2201': 5000, '2202': 4600, '2203': 3600, '2204': 6000, '2205': 7000, '2206': 8000,
  '2301': 5000, '2302': 4600, '2303': 3600, '2304': 6000,
  '2401': 5000, '2402': 4600, '2403': 3600, '2404': 6000, '2405': 7000, '2406': 8000,
  '2501': 5000, '2502': 4600, '2503': 3600, '2504': 6000, '2505': 7000, '2506': 8000,
  '3001': 3000, '3002': 3600,
  '4001': 6000, '4002': 8000, '4003': 10000, '4004': 11000, '4005': 15000, '4006': 20000, '4007': 5000,
  '4101': 30000, '4103': 50000,
  '6001': 6000, '6002': 8000, '6003': 10000, '6004': 11000, '6005': 15000, '6006': 20000,
  '8001': 6000, '8002': 3600, '8003': 5000,
  '8101': 6000, '8102': 8000, '8103': 10000,
  '8201': 6000, '8202': 8000, '8203': 10000, '8204': 12000, '8205': 11000,
  '8301': 3600, '8302': 4600, '8303': 5000, '8304': 6000,
};

/** Battery charge/discharge power in W for codes outside the 20xx family (`_DTC_BATPOWER`). */
const BATTERY_MAX_POWER: Readonly<Record<string, number>> = {
  '2201': 5400, '3001': 3000, '3002': 3000,
  '8001': 6000, '8002': 3600, '8003': 5000, '8102': 8000, '8103': 10000,
};

/** HR 2 first two hex digits. */
const CERTIFICATIONS: Readonly<Record<number, Certification>> = {
  8: 'g98',
  12: 'g99',
  16: 'g98_northern_ireland',
  17: 'g99_northern_ireland',
};

/**
 * The ARM firmware version: HR 21 on single-phase, IR 1327 on three-phase (HR 21 reads 0 there).
 * `undefined` while that register hasn't been read.
 */
export function armFirmwareVersionOf(registers: RegisterCaches, layout: Layout): number | undefined {
  return layout === 'three_phase' ? readInput(registers, 1327) : readHolding(registers, 21);
}

function hexCode(deviceTypeCode: number): string {
  return deviceTypeCode.toString(16).padStart(4, '0');
}

/** Research A: the 20xx family is 3600 W on ARM firmware 3xx/8xx/9xx, else 2600 W. */
function batteryMaxPower(code: string, armFirmwareVersion: number): number | undefined {
  if (code.startsWith('20')) {
    return [3, 8, 9].includes(Math.floor(armFirmwareVersion / 100)) ? 3600 : 2600;
  }
  return BATTERY_MAX_POWER[code];
}

function usbDevice(value: number | undefined): Identity['usbDevice'] {
  switch (value) {
    case 0: return 'none';
    case 1: return 'wifi';
    case 8: return 'disk';
    default: return 'unknown';
  }
}

export function buildIdentity(registers: RegisterCaches, context: SinglePhaseBuildContext): Identity<SinglePhaseModel>;
export function buildIdentity(registers: RegisterCaches, context: ThreePhaseBuildContext): ThreePhaseIdentity;
export function buildIdentity(
  registers: RegisterCaches,
  context: BuildContext,
): Identity<SinglePhaseModel> | ThreePhaseIdentity {
  const hr = (address: number) => readHolding(registers, address);
  const ir = (address: number) => readInput(registers, address);
  const threePhase = context.layout === 'three_phase';

  const deviceTypeCode = hr(0) ?? 0;
  const code = hexCode(deviceTypeCode);
  // HR 19/21 read 0 on three-phase; the firmware versions are in IR 1325 (AC DSP), 1326 (DC DSP)
  // and 1327 (ARM). The context resolves the ARM version the same way.
  const dsp = (threePhase ? ir(1325) : hr(19)) ?? 0;
  const arm = context.armFirmwareVersion;
  // GivTCP decodes any battery type other than 0 (and an unread one) as lithium.
  const batteryTypeRaw = threePhase ? ir(1121) : hr(54);
  const solarInputs = (hr(3) ?? 0) >> 8;
  const certificationRaw = hr(2);
  const ratedPower = RATED_POWER[code];
  const maxBatteryPower = batteryMaxPower(code, arm);
  const batterySerialNumber = readText(registers.holding, 8, 5);

  const identity: Omit<Identity, 'model'> = {
    serialNumber: readText(registers.holding, 13, 5) ?? '',
    ...(batterySerialNumber ? { batterySerialNumber } : {}),
    deviceTypeCode,
    firmware: {
      dsp,
      arm,
      batteryManagementSystem: hr(18) ?? 0,
      modbusVersion: (hr(34) ?? 0) / 100,
    },
    batteryType: batteryTypeRaw === 0 ? 'lead_acid' : 'lithium',
    batteryCapacityAh: hr(55) ?? 0,
    meterType: (hr(47) ?? 0) === 0 ? 'ct_or_em418' : 'em115',
    ...(ratedPower !== undefined ? { ratedPower } : {}),
    ...(maxBatteryPower !== undefined ? { batteryMaxPower: maxBatteryPower } : {}),
    ...(solarInputs > 0 ? { solarInputCount: solarInputs } : {}),
    usbDevice: usbDevice(hr(22)),
    ammeterEnabled: (hr(7) ?? 0) !== 0,
    ...(certificationRaw !== undefined
      ? { certification: CERTIFICATIONS[certificationRaw >> 8] ?? 'unknown' }
      : {}),
    modbusAddress: hr(30) ?? 0,
    userCode: hr(33) ?? 0,
  };

  if (context.layout === 'single_phase') return { ...identity, model: context.model };
  return {
    ...identity,
    model: context.model,
    firmware: { ...identity.firmware, dcDsp: ir(1326) ?? 0 },
  };
}
