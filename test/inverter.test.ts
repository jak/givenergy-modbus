import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'net';
import { GivEnergyInverter, SinglePhaseInverter, ThreePhaseInverter } from '../src/inverter.js';
import { UnsupportedDeviceError } from '../src/errors.js';
import { PollManager } from '../src/poll-manager.js';
import { buildMockResponse as buildIdentifyResponse, stringToRegisters } from './helpers/mock-frame.js';

/** Serve one HR 0–59 response to the first request, as `identify()` expects. */
async function identifyAgainst(registers: number[]) {
  const sockets: Socket[] = [];
  const response = buildIdentifyResponse(registers);
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    socket.once('data', () => socket.write(response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    sockets,
    identify: () => GivEnergyInverter.identify({ host: '127.0.0.1', port }),
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

function identityRegisters(serial: string, deviceTypeCode: number, armFirmwareVersion: number): number[] {
  const registers = new Array(60).fill(0);
  registers[0] = deviceTypeCode;
  const serialRegs = stringToRegisters(serial);
  for (let i = 0; i < 5; i++) registers[13 + i] = serialRegs[i];
  registers[21] = armFirmwareVersion;
  return registers;
}

describe('GivEnergyInverter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has a concrete class per layout', () => {
    expect(SinglePhaseInverter.prototype).toBeInstanceOf(GivEnergyInverter);
    expect(ThreePhaseInverter.prototype).toBeInstanceOf(GivEnergyInverter);
  });

  it.each([
    ['empty', ''],
    // registersToString turns all-zero registers into NUL bytes, which trim() doesn't strip.
    ['NUL-filled', '\x00'.repeat(10)],
  ])('connect() rejects a %s serial number (#23)', async (_name, serialNumber) => {
    vi.spyOn(PollManager.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(PollManager.prototype, 'getData').mockReturnValue({
      layout: 'single_phase',
      model: 'hybrid_gen2',
      identity: { serialNumber },
    } as never);
    const stop = vi.spyOn(PollManager.prototype, 'stop').mockResolvedValue(undefined);

    await expect(GivEnergyInverter.connect({ host: '192.168.50.118' })).rejects.toThrow('No valid inverter found');
    expect(stop).toHaveBeenCalled();
  });

  describe('identify()', () => {
    it.each([
      // 20xx is shared by Gen1, Gen2 and Gen3: the ARM firmware century tells them apart.
      ['a Gen2 (20xx, ARM 8xx)', 0x2001, 899, 'hybrid_gen2', 'single_phase'],
      ['a Gen3 (20xx, ARM 3xx)', 0x2001, 301, 'hybrid_gen3', 'single_phase'],
      ['a three-phase Hybrid (40xx)', 0x4004, 0, 'hybrid_3ph', 'three_phase'],
    ])('reads %s from one HR 0–59 request', async (_name, deviceTypeCode, arm, model, layout) => {
      const server = await identifyAgainst(identityRegisters('FD0000A000', deviceTypeCode, arm));
      try {
        expect(await server.identify()).toEqual({ serialNumber: 'FD0000A000', deviceTypeCode, model, layout });
      } finally {
        server.close();
      }
    });

    it('rejects a device with no serial number (not a GivEnergy inverter)', async () => {
      const server = await identifyAgainst(new Array(60).fill(0));
      try {
        await expect(server.identify()).rejects.toThrow('No valid inverter found');
      } finally {
        server.close();
      }
    });

    it.each([
      ['a plant controller', 0x5101, 'ems'],
      // 2.x fell back to the serial prefix when HR 0 read 0; v3 has no model to fall back to.
      ['a device type code of 0, even with a serial number', 0x0000, 'unknown'],
    ])('rejects %s with UnsupportedDeviceError', async (_name, deviceTypeCode, model) => {
      const server = await identifyAgainst(identityRegisters('SA9999X123', deviceTypeCode, 0));
      try {
        await expect(server.identify()).rejects.toMatchObject({ name: 'UnsupportedDeviceError', model });
        await expect(server.identify()).rejects.toBeInstanceOf(UnsupportedDeviceError);
      } finally {
        server.close();
      }
    });

    it('closes the connection after reading identity', async () => {
      const server = await identifyAgainst(identityRegisters('FD0000A000', 0x2001, 899));
      try {
        await server.identify();
        // The server sees the close shortly after identify() resolves.
        await vi.waitFor(() => {
          expect(server.sockets.length).toBeGreaterThan(0);
          for (const s of server.sockets) expect(s.destroyed || s.readableEnded).toBe(true);
        });
      } finally {
        server.close();
      }
    });
  });
});
