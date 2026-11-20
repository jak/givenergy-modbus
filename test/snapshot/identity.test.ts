import { describe, expect, it } from 'vitest';
import { buildIdentity } from '../../src/snapshot/identity.js';
import {
  capture,
  contextFor,
  INVERTER_CAPTURES,
  reference,
  registersOf,
  singlePhaseContextFor,
  threePhaseContextFor,
} from '../helpers/snapshot-fixtures.js';
import { buildForLayout } from '../../src/snapshot/read.js';

describe('buildIdentity on the Gen3 reference unit', () => {
  const registers = reference();
  const identity = buildIdentity(registers, singlePhaseContextFor(registers));

  it('matches website/register-map.md', () => {
    expect(identity).toEqual({
      serialNumber: 'FD0000A000', // placeholder serial
      batterySerialNumber: 'DZ0000B000', // placeholder serial
      deviceTypeCode: 0x2001,
      model: 'hybrid_gen3',
      firmware: { dsp: 316, arm: 316, batteryManagementSystem: 4009, modbusVersion: 1.4 },
      batteryType: 'lithium',
      batteryCapacityAh: 186,
      // HR 47 = 1: the GivEnergy meter on slave 0x01 is an EM115.
      meterType: 'em115',
      ratedPower: 5000,
      // 20xx family with ARM firmware century 3.
      batteryMaxPower: 3600,
      // HR 22 reads 2: see the USB device quirk test below.
      usbDevice: 'unknown',
      ammeterEnabled: true,
      // HR 2 = 0x0C32: first two hex digits 0x0C = 12.
      certification: 'g99',
      modbusAddress: 17,
      userCode: 7,
    });
  });

  it('leaves out the solar input count when HR 3 reads 0', () => {
    expect(identity).not.toHaveProperty('solarInputCount');
  });
});

describe('buildIdentity quirks', () => {
  const singlePhase = (holding: Record<number, number>) => {
    const registers = registersOf({ 0: 0x2001, 21: 316, ...holding });
    return buildIdentity(registers, singlePhaseContextFor(registers));
  };

  it('reads the solar input count from the high byte of HR 3', () => {
    expect(singlePhase({ 3: 0x0201 }).solarInputCount).toBe(2);
  });

  it('decodes the certification table and keeps unknown codes as "unknown"', () => {
    expect(singlePhase({ 2: 0x0832 }).certification).toBe('g98');
    expect(singlePhase({ 2: 0x1000 }).certification).toBe('g98_northern_ireland');
    expect(singlePhase({ 2: 0x1100 }).certification).toBe('g99_northern_ireland');
    expect(singlePhase({ 2: 0x0000 }).certification).toBe('unknown');
    expect(singlePhase({})).not.toHaveProperty('certification');
  });

  it('treats battery type 0 as lead acid and anything else as lithium, as GivTCP does', () => {
    expect(singlePhase({ 54: 0 }).batteryType).toBe('lead_acid');
    expect(singlePhase({ 54: 1 }).batteryType).toBe('lithium');
    expect(singlePhase({ 54: 7 }).batteryType).toBe('lithium');
  });

  it('decodes HR 22 = 2 as "unknown" because the sources conflict', () => {
    // Quirk: HR 22 reads 2 on the reference unit and on every capture. GivTCP's UsbDevice is
    // 0 none, 1 Wi-Fi, 8 disk, so 2 has no name. The external library's UsbDevice is
    // 0 none, 1 Wi-Fi, 2 disk, which would make the reference unit a disk, yet it has a
    // Wi-Fi dongle. Until that is resolved, 2 decodes as 'unknown'.
    expect(singlePhase({ 22: 2 }).usbDevice).toBe('unknown');
    for (const name of INVERTER_CAPTURES.map((c) => c.name).filter((n) => !n.startsWith('hybrid_hv_gen3'))) {
      expect(capture(name).holding.get(22)).toBe(2);
    }
  });

  it('names the USB devices it knows', () => {
    expect(singlePhase({ 22: 0 }).usbDevice).toBe('none');
    expect(singlePhase({ 22: 1 }).usbDevice).toBe('wifi');
    expect(singlePhase({ 22: 8 }).usbDevice).toBe('disk');
  });

  it('gives Gen1/Gen2 firmware centuries their own battery power', () => {
    const gen1 = registersOf({ 0: 0x2001, 21: 449 });
    expect(buildIdentity(gen1, singlePhaseContextFor(gen1)).batteryMaxPower).toBe(2600);
    const gen2 = registersOf({ 0: 0x2001, 21: 920 });
    expect(buildIdentity(gen2, singlePhaseContextFor(gen2)).batteryMaxPower).toBe(3600);
  });

  it('leaves out rated and battery power for codes it has no table entry for', () => {
    const registers = registersOf({ 0: 0x2207, 21: 316 });
    const identity = buildIdentity(registers, singlePhaseContextFor(registers));
    expect(identity).not.toHaveProperty('ratedPower');
    expect(identity).not.toHaveProperty('batteryMaxPower');
    // The 20xx family gets battery power from its firmware rule even without a rated power entry.
    const unlisted = registersOf({ 0: 0x2007, 21: 316 });
    expect(buildIdentity(unlisted, singlePhaseContextFor(unlisted))).toMatchObject({ batteryMaxPower: 3600 });
    expect(buildIdentity(unlisted, singlePhaseContextFor(unlisted))).not.toHaveProperty('ratedPower');
  });

  it('strips padding from serial numbers and leaves out an empty battery serial', () => {
    const identity = singlePhase({ 13: 0x4144, 14: 0x3132, 15: 0x3300, 16: 0, 17: 0 });
    expect(identity.serialNumber).toBe('AD123');
    expect(identity).not.toHaveProperty('batterySerialNumber');
  });
});

describe('buildIdentity on three-phase', () => {
  const registers = capture('hybrid_3ph.log');
  const identity = buildIdentity(registers, threePhaseContextFor(registers));

  it('reads firmware from IR 1325–1327 because HR 19/21 read 0', () => {
    expect(registers.holding.get(21)).toBe(0);
    expect(identity.model).toBe('hybrid_3ph');
    expect(identity.firmware).toMatchObject({ dsp: 11043, dcDsp: 10311, arm: 11121 });
  });

  it('reads the battery type from IR 1121', () => {
    expect(identity.batteryType).toBe('lithium');
    expect(identity.ratedPower).toBe(11000); // 0x4004
  });
});

describe.each(INVERTER_CAPTURES)('buildIdentity on capture $name', ({ name, inject }) => {
  it('decodes without throwing and gives plausible values', () => {
    const registers = capture(name, inject);
    const context = contextFor(registers);
    const identity = buildForLayout(buildIdentity, registers, context);
    expect(identity.model).toBe(context.model);
    expect(identity.deviceTypeCode).toBeGreaterThan(0);
    expect(identity.firmware.arm).toBeGreaterThan(0);
    expect(identity.batteryCapacityAh).toBeGreaterThanOrEqual(0);
    expect(identity.modbusAddress).toBeLessThanOrEqual(100);
    if (name !== 'hybrid_hv_gen3_arm295.log') expect(identity.serialNumber).toMatch(/^[A-Z]{2}\d{4}[A-Z]\d{3}$/);
  });
});
