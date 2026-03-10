import * as net from 'net';
import * as os from 'os';
import { Client } from './client.js';
import { encodeReadHoldingRegistersRequest } from './pdu/encode.js';

/** GivEnergy inverters always listen on this port */
const INVERTER_PORT = 8899;
const SCAN_TIMEOUT_MS = 1000;
const VERIFY_TIMEOUT_MS = 3000;
const CONCURRENCY = 20;

export interface DiscoveredDevice {
  host: string;
}

/**
 * Parse a CIDR notation subnet into a list of host IP addresses.
 * Excludes network address (first) and broadcast address (last) for /24 and smaller.
 *
 * @param cidr - e.g. '192.168.1.0/24' or '192.168.1.50/32'
 */
export function parseSubnet(cidr: string): string[] {
  const [baseIp, prefixLenStr] = cidr.split('/');
  const prefixLen = parseInt(prefixLenStr, 10);

  const ipParts = baseIp.split('.').map(Number);
  const baseInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];

  if (prefixLen === 32) {
    return [baseIp];
  }

  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  const network = (baseInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  const hosts: string[] = [];
  for (let ip = network + 1; ip < broadcast; ip++) {
    hosts.push([
      (ip >>> 24) & 0xFF,
      (ip >>> 16) & 0xFF,
      (ip >>> 8) & 0xFF,
      ip & 0xFF,
    ].join('.'));
  }
  return hosts;
}

/**
 * Detect the local subnet by finding the first non-loopback IPv4 interface.
 * Assumes a /24 subnet (same assumption as the UDP trick approach).
 */
export function getLocalSubnet(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const iface = ifaces[name];
    if (!iface) continue;
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal && info.cidr) {
        return info.cidr;
      }
    }
  }
  throw new Error('Could not detect local subnet: no external IPv4 interface found');
}

/**
 * Attempt a TCP connection to a host:port with a timeout.
 * Returns true if connection succeeded (port is open), false otherwise.
 */
function tryConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let resolved = false;

    const done = (result: boolean) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
    socket.on('timeout', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * Verify a candidate host is a real GivEnergy inverter by sending a modbus
 * read request and checking for a valid response. Matches GivTCP's active
 * probe approach during discovery.
 */
async function verifyInverter(host: string): Promise<boolean> {
  const client = new Client({ host, timeout: VERIFY_TIMEOUT_MS, retries: 0 });
  try {
    await client.connect();
    const frame = encodeReadHoldingRegistersRequest({
      dataAdapterSerial: '**********',
      slaveAddress: 0x11,
      baseRegister: 0,
      registerCount: 1,
    });
    await client.sendRequest(frame);
    return true;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

export interface DiscoverOptions {
  subnet?: string;
  /** Called for each host after probing it */
  onProbe?: (host: string, found: boolean) => void;
}

/**
 * Scan a subnet for GivEnergy inverters using a two-phase approach:
 *
 * 1. Fast TCP port scan on port 8899 (1s timeout, 20 concurrent)
 * 2. Active modbus probe on each candidate to verify it's a real GivEnergy inverter
 *
 * Mirrors GivTCP's findInvertor.py discovery strategy.
 *
 * @param subnetOrOptions - Optional CIDR string or options object. Subnet auto-detected if not provided.
 * @returns Array of discovered devices (host IP strings)
 */
export async function discover(subnetOrOptions?: string | DiscoverOptions): Promise<DiscoveredDevice[]> {
  const options: DiscoverOptions = typeof subnetOrOptions === 'string'
    ? { subnet: subnetOrOptions }
    : (subnetOrOptions ?? {});

  const cidr = options.subnet ?? getLocalSubnet();
  const hosts = parseSubnet(cidr);
  const candidates: string[] = [];

  // Phase 1: Fast TCP port scan
  for (let i = 0; i < hosts.length; i += CONCURRENCY) {
    const batch = hosts.slice(i, i + CONCURRENCY);
    const checks = await Promise.all(
      batch.map(async host => {
        const open = await tryConnect(host, INVERTER_PORT, SCAN_TIMEOUT_MS);
        options.onProbe?.(host, open);
        return open ? host : null;
      })
    );
    for (const host of checks) {
      if (host !== null) candidates.push(host);
    }
  }

  // Phase 2: Verify each candidate with an active modbus probe
  const results: DiscoveredDevice[] = [];
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const verified = await Promise.all(
      batch.map(async host => {
        const isInverter = await verifyInverter(host);
        return isInverter ? host : null;
      })
    );
    for (const host of verified) {
      if (host !== null) results.push({ host });
    }
  }

  return results;
}
