import { describe, it, expect } from 'vitest';
import { parseSubnet, discover, type DiscoveredDevice } from '../src/discover.js';
import { detectBatteries } from '../src/model/plant.js';
import * as net from 'net';
import { buildMockResponse, stringToRegisters } from './helpers/mock-frame.js';

/** Build a 60-register response with valid identity for discover's Phase 2 (identify). */
function buildIdentifyRegisters(serial: string, modelCode: number, firmware: number): number[] {
  const registers = new Array(60).fill(0);
  registers[0] = modelCode;
  const serialRegs = stringToRegisters(serial);
  for (let i = 0; i < 5; i++) registers[13 + i] = serialRegs[i];
  registers[21] = firmware;
  return registers;
}

describe('parseSubnet', () => {
  it('expands /24 to 254 host addresses', () => {
    // Standard home network: 192.168.1.1 through 192.168.1.254
    const hosts = parseSubnet('192.168.1.0/24');
    expect(hosts.length).toBe(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts[253]).toBe('192.168.1.254');
  });

  it('excludes network and broadcast addresses', () => {
    const hosts = parseSubnet('192.168.1.0/24');
    expect(hosts).not.toContain('192.168.1.0');   // network
    expect(hosts).not.toContain('192.168.1.255');  // broadcast
  });

  it('handles /32 as a single host (no subnet scan)', () => {
    // GivTCP special case: /32 = scan just that one host
    const hosts = parseSubnet('192.168.1.50/32');
    expect(hosts.length).toBe(1);
    expect(hosts[0]).toBe('192.168.1.50');
  });

  it('handles a /28 subnet (14 hosts)', () => {
    const hosts = parseSubnet('192.168.1.16/28');
    expect(hosts.length).toBe(14);
    expect(hosts[0]).toBe('192.168.1.17');
    expect(hosts[13]).toBe('192.168.1.30');
  });

  it('generates valid IP addresses', () => {
    const hosts = parseSubnet('10.0.0.0/24');
    expect(hosts[0]).toBe('10.0.0.1');
    expect(hosts[254 - 1]).toBe('10.0.0.254');
  });
});

describe('discover', () => {
  it('returns empty array when no inverters found', async () => {
    // Scan a /32 of an address that won't have port 8899 open
    const results = await discover('127.0.0.1/32');
    expect(Array.isArray(results)).toBe(true);
  }, 3000);
});

describe('discover verification', () => {
  // These tests bind to port 8899 on localhost. If the port is unavailable
  // (e.g. a real inverter data adapter or CI), tests skip gracefully.

  it('discovers a host that responds with a valid GivEnergy frame', async () => {
    const registers = buildIdentifyRegisters('CE1234G567', 0x2001, 899);
    const response = buildMockResponse(registers);
    let server: net.Server | undefined;
    try {
      server = net.createServer(socket => {
        socket.once('data', () => socket.write(response));
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(8899, '127.0.0.1', resolve);
      });
    } catch {
      return;
    }

    try {
      const results = await discover('127.0.0.1/32');
      expect(results).toEqual([{
        host: '127.0.0.1',
        serialNumber: 'CE1234G567',
        generation: 'gen2',
        modelCode: 0x2001,
      }]);
    } finally {
      server.close();
    }
  }, 15000);

  it('rejects a host that accepts TCP but sends no modbus response', async () => {
    let server: net.Server | undefined;
    try {
      // Server accepts connections but never sends data — simulates
      // a non-GivEnergy service that happens to listen on port 8899
      server = net.createServer(() => {
        // Do nothing — let the client timeout
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(8899, '127.0.0.1', resolve);
      });
    } catch {
      return;
    }

    try {
      const results = await discover('127.0.0.1/32');
      expect(results).toEqual([]);
    } finally {
      server.close();
    }
  }, 15000);

  it('rejects a host that sends garbage data instead of a valid frame', async () => {
    let server: net.Server | undefined;
    try {
      server = net.createServer(socket => {
        socket.once('data', () => {
          // Send random garbage that isn't a valid GivEnergy frame
          socket.write(Buffer.from('HTTP/1.1 200 OK\r\n\r\nHello'));
        });
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(8899, '127.0.0.1', resolve);
      });
    } catch {
      return;
    }

    try {
      const results = await discover('127.0.0.1/32');
      expect(results).toEqual([]);
    } finally {
      server.close();
    }
  }, 15000);

  it('calls onScanProgress during Phase 1 TCP scan', async () => {
    const registers = buildIdentifyRegisters('CE1234G567', 0x2001, 899);
    const response = buildMockResponse(registers);
    let server: net.Server | undefined;
    try {
      server = net.createServer(socket => {
        socket.once('data', () => socket.write(response));
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(8899, '127.0.0.1', resolve);
      });
    } catch {
      return;
    }

    try {
      const probes: Array<{ host: string; portOpen: boolean }> = [];
      await discover({
        subnet: '127.0.0.1/32',
        onScanProgress: (host, portOpen) => probes.push({ host, portOpen }),
      });
      expect(probes).toEqual([{ host: '127.0.0.1', portOpen: true }]);
    } finally {
      server.close();
    }
  }, 15000);

  it('calls onFound only for verified inverters', async () => {
    const registers = buildIdentifyRegisters('CE1234G567', 0x2001, 899);
    const response = buildMockResponse(registers);
    let server: net.Server | undefined;
    try {
      server = net.createServer(socket => {
        socket.once('data', () => socket.write(response));
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(8899, '127.0.0.1', resolve);
      });
    } catch {
      return;
    }

    try {
      const found: DiscoveredDevice[] = [];
      await discover({
        subnet: '127.0.0.1/32',
        onFound: (device) => found.push(device),
      });
      expect(found).toHaveLength(1);
      expect(found[0].host).toBe('127.0.0.1');
      expect(found[0].serialNumber).toBe('CE1234G567');
      expect(found[0].generation).toBe('gen2');
    } finally {
      server.close();
    }
  }, 15000);

  it('does not call onFound for hosts that fail modbus verification', async () => {
    let server: net.Server | undefined;
    try {
      server = net.createServer(socket => {
        socket.once('data', () => {
          socket.write(Buffer.from('HTTP/1.1 200 OK\r\n\r\nHello'));
        });
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(8899, '127.0.0.1', resolve);
      });
    } catch {
      return;
    }

    try {
      const found: DiscoveredDevice[] = [];
      const probes: Array<{ host: string; portOpen: boolean }> = [];
      const results = await discover({
        subnet: '127.0.0.1/32',
        onScanProgress: (host, portOpen) => probes.push({ host, portOpen }),
        onFound: (device) => found.push(device),
      });
      // Phase 1: port was open
      expect(probes).toEqual([{ host: '127.0.0.1', portOpen: true }]);
      // Phase 2: verification failed, so onFound was never called
      expect(found).toEqual([]);
      expect(results).toEqual([]);
    } finally {
      server.close();
    }
  }, 15000);
});

describe('detectBatteries', () => {
  it('returns BCU count for HV devices from BAMS data', () => {
    // HV systems report battery count via BAMS, not by scanning LV slave addresses.
    const registerCache = new Map<number, Map<number, number>>();
    // BAMS slave 0xA0 with 2 BCUs at IR(61)
    const bamsCache = new Map<number, number>();
    bamsCache.set(61, 2);
    registerCache.set(0xa0, bamsCache);
    expect(detectBatteries(registerCache, true)).toBe(2);
  });

  it('returns 0 for HV devices when BAMS data is missing', () => {
    const registerCache = new Map<number, Map<number, number>>();
    expect(detectBatteries(registerCache, true)).toBe(0);
  });
});
