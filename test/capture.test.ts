import { describe, it, expect } from 'vitest';
import { loadCapture, parseCapture } from './helpers/capture.js';
import { resolveModel, type DeviceModel } from '../src/model/models.js';

/**
 * Builds a transparent response frame in the wire layout decodePdu expects.
 * The CRC is left as zero because the capture loader does not check it.
 */
function transparentFrame(slave: number, functionCode: number, base: number, values: number[]): string {
  const body = Buffer.alloc(36 + values.length * 2 + 2);
  body[0] = 0x01; // uid
  body[1] = 0x02; // fid: transparent
  body.write('WX0000X000', 2, 'latin1');
  body.writeBigUInt64BE(8n, 12); // padding
  body[20] = slave;
  body[21] = functionCode;
  body.write('XX0000X000', 22, 'latin1');
  body.writeUInt16BE(base, 32);
  body.writeUInt16BE(values.length, 34);
  values.forEach((v, i) => body.writeUInt16BE(v, 36 + i * 2));
  const header = Buffer.alloc(6);
  header.writeUInt16BE(0x5959, 0);
  header.writeUInt16BE(0x0001, 2);
  header.writeUInt16BE(body.length, 4);
  return Buffer.concat([header, body]).toString('hex');
}

/** Heartbeat from data adapter WX0000X000 (type 1). */
const heartbeat = '59590001000d0101' + Buffer.from('WX0000X000', 'latin1').toString('hex') + '01';

describe('parseCapture', () => {
  it('reads both "<timestamp> rx <hex>" and "rx: <hex>" lines, ignoring comments and tx', () => {
    const plant = parseCapture([
      '# header comment',
      `2026-01-01T00:00:00+00:00 rx ${transparentFrame(0x11, 3, 0, [0x2003])}`,
      `rx: ${transparentFrame(0x11, 4, 60, [1, 2])}`,
      `tx: ${transparentFrame(0x11, 3, 120, [9])}`,
    ].join('\n'));
    expect(plant.rxFrames).toBe(2);
    expect(plant.slave(0x11).holding.get(0)).toBe(0x2003);
    expect(plant.slave(0x11).holding.has(120)).toBe(false);
    expect(plant.slave(0x11).input.get(61)).toBe(2);
  });

  it('skips heartbeats, error replies and write echoes, counting each', () => {
    const plant = parseCapture([
      `rx ${heartbeat}`,
      `rx ${transparentFrame(0x11, 0x83, 1100, [0])}`, // error reply: high bit set
      `rx ${transparentFrame(0x11, 6, 20, [1])}`, // write echo: base is the written register
      `rx ${transparentFrame(0x11, 3, 0, [1])}`,
    ].join('\n'));
    expect(plant.skipped).toMatchObject({ heartbeat: 1, error: 1, otherFunctionCode: 1 });
    expect(plant.slave(0x11).holding.has(1100)).toBe(false);
    expect(plant.slave(0x11).holding.has(20)).toBe(false);
  });

  it('keeps the 0x86 function code, which is a Gen1 battery write quirk, not an error', () => {
    const plant = parseCapture(`rx ${transparentFrame(0x11, 0x86, 0, [1])}`);
    expect(plant.skipped.error).toBe(0);
    expect(plant.skipped.otherFunctionCode).toBe(1);
  });

  it('splits frames the capture tool glued together on one line', () => {
    const plant = parseCapture(`rx ${transparentFrame(0x11, 4, 1780, [7])}${heartbeat}`);
    expect(plant.slave(0x11).input.get(1780)).toBe(7);
    expect(plant.skipped.heartbeat).toBe(1);
    expect(plant.skipped.malformed).toBe(0);
  });

  it('counts a truncated frame as malformed instead of loading partial registers', () => {
    const plant = parseCapture(`rx ${transparentFrame(0x11, 4, 0, [1, 2, 3]).slice(0, -6)}`);
    expect(plant.skipped.malformed).toBe(1);
    expect(plant.slaves.size).toBe(0);
  });

  it('throws for a slave address that is not in the capture, so typos fail loudly', () => {
    const plant = parseCapture(`rx ${transparentFrame(0x11, 3, 0, [1])}`);
    expect(() => plant.slave(0x99)).toThrow(/0x99.*0x11/);
  });
});

describe('loadCapture', () => {
  it('decodes rx frames into per-slave holding and input register caches', () => {
    const plant = loadCapture('hybrid_gen2_arm920.log');
    const inverter = plant.slave(0x11);
    expect(inverter.holding.get(0)?.toString(16)).toBe('2003');
    expect(inverter.holding.get(21)).toBe(920);
    expect(inverter.input.size).toBeGreaterThanOrEqual(60);
  });

  it('all_in_one_arm620 holds no error replies and never asks for HR 1100', () => {
    // Upstream notes that the All in One error-responds to 1000-range reads, but that
    // evidence is in a different capture. This one polls HR 0-179 and 240-359 only.
    const plant = loadCapture('all_in_one_arm620.log');
    expect(plant.skipped.error).toBe(0);
    expect(plant.slave(0x11).holding.has(1100)).toBe(false);
    expect(plant.slave(0x11).holding.has(180)).toBe(false);
  });

  it('gateway_gaaa0014 has an IR 1780 reply with a heartbeat glued to its end', () => {
    const plant = loadCapture('gateway_gaaa0014.log');
    expect(plant.skipped.malformed).toBe(0);
    expect(plant.slave(0x11).input.has(1780)).toBe(true);
  });

  // The inverter (or plant controller) answers at 0x11 in every capture. Some also answer
  // the same register file at 0x31/0x32, and batteries, meters and HV battery modules
  // answer at their own addresses.
  const captures: Array<{ name: string; inverterSlave: number; model: DeviceModel | undefined; alsoAt?: number[] }> = [
    { name: 'hybrid_gen1_arm449.log', inverterSlave: 0x11, model: 'hybrid_gen1', alsoAt: [0x31] },
    { name: 'hybrid_gen2_arm920.log', inverterSlave: 0x11, model: 'hybrid_gen2' },
    { name: 'ac_arm282.log', inverterSlave: 0x11, model: 'ac', alsoAt: [0x31, 0x32] },
    { name: 'all_in_one_arm620.log', inverterSlave: 0x11, model: 'all_in_one' },
    // Three-phase keeps its ARM firmware elsewhere: HR 21 reads 0 here.
    { name: 'hybrid_3ph.log', inverterSlave: 0x11, model: 'hybrid_3ph' },
    // No HR 0-179 in this capture; a later test injects HR 0 = 0x8102 and HR 21 = 295.
    { name: 'hybrid_hv_gen3_arm295.log', inverterSlave: 0x11, model: undefined },
    { name: 'ems_arm1036.log', inverterSlave: 0x11, model: 'ems' },
    { name: 'gateway_gaaa0014.log', inverterSlave: 0x11, model: 'gateway' },
  ];

  for (const { name, inverterSlave, model, alsoAt = [] } of captures) {
    it(`${name} loads and resolves to ${model ?? 'no model (HR 0 absent)'}`, () => {
      const plant = loadCapture(name);
      expect(plant.slaves.size).toBeGreaterThan(0);
      expect(plant.skipped.malformed).toBe(0);
      for (const address of [inverterSlave, ...alsoAt]) {
        const { holding } = plant.slave(address);
        const deviceTypeCode = holding.get(0);
        const armFirmwareVersion = holding.get(21);
        if (model === undefined) {
          expect(deviceTypeCode).toBeUndefined();
        } else {
          expect(deviceTypeCode).toBeDefined();
          expect(armFirmwareVersion).toBeDefined();
          expect(resolveModel(deviceTypeCode!, armFirmwareVersion!)).toBe(model);
        }
      }
    });
  }

  it('hybrid_3ph reports HR 0 = 0x4004 and HR 21 = 0', () => {
    const { holding } = loadCapture('hybrid_3ph.log').slave(0x11);
    expect(holding.get(0)).toBe(0x4004);
    expect(holding.get(21)).toBe(0);
  });
});
