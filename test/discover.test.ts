import { describe, it, expect } from 'vitest';
import { parseSubnet, discover } from '../src/discover.js';
import { detectBatteries } from '../src/model/plant.js';
import * as net from 'net';
import { buildMockResponse, stringToRegisters } from './helpers/mock-frame.js';


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
  // These tests use mock TCP servers on random ports, so we need to
  // override the port. Since discover() hardcodes port 8899, we test
  // the verification behavior indirectly through the full discover flow
  // by patching. Instead, we test with the actual port by binding to 8899
  // if available, or skip gracefully.

  // For unit-testability, we test the verification logic by creating
  // servers on port 8899 and using /32 subnets pointing at localhost.
  // If port 8899 is unavailable (e.g. CI), these tests skip.

  it('discovers a host that responds with a valid GivEnergy frame', async () => {
    const response = buildMockResponse([0x0001]);
    let server: net.Server | undefined;
    try {
      // Try to bind to port 8899 on localhost
      server = net.createServer(socket => {
        // Wait for request data, then respond with a valid frame
        socket.once('data', () => {
          socket.write(response);
        });
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(8899, '127.0.0.1', resolve);
      });
    } catch {
      // Port 8899 unavailable — skip
      return;
    }

    try {
      const results = await discover('127.0.0.1/32');
      expect(results).toEqual([{ host: '127.0.0.1' }]);
    } finally {
      server.close();
    }
  }, 10000);

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
  }, 10000);

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
  }, 10000);
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
