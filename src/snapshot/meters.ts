/**
 * CT meters at device addresses 0x01–0x08: data from IR 60–88 (function 4) and product
 * information from registers 60–66 (function 22). Moved from 2.x `buildMeterSnapshot`.
 */
import type { Meter, ThreePhase } from '../model/snapshot.js';
import { registersToString, toCenti, toDeci, toInt16, toOffsetPowerFactor, toUint32 } from '../model/converters.js';
import type { MeterCaches, RegisterCaches } from './read.js';

type ProductInformation = Pick<Meter, 'serialNumber' | 'factoryCode' | 'meterType' | 'hardwareVersion' | 'softwareVersion'>;

/**
 * The function 22 product fields whose registers were read. A meter that didn't answer
 * function 22 (the Gen2 capture's) has none, rather than zero-filled ones.
 */
function productInformation(product: Map<number, number>): ProductInformation {
  const read = (...registers: number[]) => {
    const values = registers.map((register) => product.get(register));
    return values.every((value) => value !== undefined) ? (values as number[]) : undefined;
  };
  const serial = read(60, 61);
  const factory = read(62, 63);
  const [meterType] = read(64) ?? [];
  const [hardwareVersion] = read(65) ?? [];
  const [softwareVersion] = read(66) ?? [];
  return {
    ...(serial ? { serialNumber: toUint32(serial[0], serial[1]) } : {}),
    ...(factory ? { factoryCode: registersToString(factory).replace(/\0/g, '') } : {}),
    ...(meterType !== undefined ? { meterType } : {}),
    ...(hardwareVersion !== undefined ? { hardwareVersion } : {}),
    ...(softwareVersion !== undefined ? { softwareVersion } : {}),
  };
}

function meter({ slaveAddress, input, product }: MeterCaches): Meter | null {
  const get = (register: number) => input.get(register) ?? 0;
  const phases = (from: number, decode: (raw: number) => number): ThreePhase<number> =>
    [decode(get(from)), decode(get(from + 1)), decode(get(from + 2))];
  const signed = (raw: number) => toInt16(raw);
  // Raw VA, unsigned (a magnitude). Research C says ÷10, but every capture fits raw: single-phase
  // V × I matches it, and ÷10 would put three-phase S below |P|. 2.x read it raw but signed.
  const apparent = (raw: number) => raw;

  // No meter at this address when phase 1 voltage reads 0 (2.x).
  if (get(60) === 0) return null;

  const voltage = phases(60, toDeci);
  const activePower = phases(68, signed);
  const reactivePower = phases(72, signed);
  const apparentPower = phases(76, apparent);
  // Offset-unsigned (raw ÷10000 − 1), like the inverter's IR 16. Signed ÷10000 (2.x) gives values
  // above 1 on every capture; the offset decode matches |P / S|.
  const powerFactor = phases(80, toOffsetPowerFactor);
  let activePowerTotal = toInt16(get(71));
  let reactivePowerTotal = toInt16(get(75));
  let apparentPowerTotal = apparent(get(79));
  let powerFactorTotal = toOffsetPowerFactor(get(83));

  // A single-phase meter leaves the total registers at 0, so use phase 1 (2.x).
  if (voltage[1] === 0 && voltage[2] === 0) {
    if (activePowerTotal === 0) activePowerTotal = activePower[0];
    if (reactivePowerTotal === 0) reactivePowerTotal = reactivePower[0];
    if (apparentPowerTotal === 0) apparentPowerTotal = apparentPower[0];
    // Compare the raw register: offset decoding turns raw 0 into −1.
    if (get(83) === 0) powerFactorTotal = powerFactor[0];
  }

  return {
    slaveAddress,
    ...productInformation(product),
    voltage,
    current: phases(63, toCenti),
    activePower,
    activePowerTotal,
    reactivePower,
    reactivePowerTotal,
    apparentPower,
    apparentPowerTotal,
    powerFactor,
    powerFactorTotal,
    frequency: toCenti(get(84)),
    importActiveEnergyKwh: toDeci(get(85)),
    importReactiveEnergyKvarh: toDeci(get(86)),
    exportActiveEnergyKwh: toDeci(get(87)),
    exportReactiveEnergyKvarh: toDeci(get(88)),
  };
}

/** Every meter in `registers.meters` that is present, in address order. */
export function buildMeters(registers: RegisterCaches): Meter[] {
  return (registers.meters ?? []).flatMap((caches) => meter(caches) ?? []);
}
