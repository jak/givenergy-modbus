import * as net from 'net';
import dgram from 'dgram';

/** GivEnergy inverters always listen on this port */
const INVERTER_PORT = 8899;
const SCAN_TIMEOUT_MS = 1000;
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
 * Detect the local subnet using the UDP trick.
 *
 * Opens a UDP socket and "connects" to a non-routable address (no packet sent).
 * The OS selects the outbound interface, giving us our local IP.
 * We then assume a /24 subnet — the true mask is not available this way.
 *
 * This mirrors GivTCP's Docker path in startup.py.
 */
export function getLocalSubnet(): string {
  const socket = dgram.createSocket('udp4');
  try {
    socket.connect(1, '10.254.254.254');
    const address = socket.address();
    return `${address.address}/24`;
  } finally {
    socket.close();
  }
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
 * Scan a subnet for GivEnergy inverters by probing port 8899.
 *
 * Uses up to 20 concurrent connection attempts with 1s timeout each.
 * Mirrors GivTCP's findInvertor.py Threader(20) approach.
 *
 * @param subnet - Optional CIDR string. Auto-detected if not provided.
 * @returns Array of discovered devices (host IP strings)
 */
export async function discover(subnet?: string): Promise<DiscoveredDevice[]> {
  const cidr = subnet ?? getLocalSubnet();
  const hosts = parseSubnet(cidr);
  const results: DiscoveredDevice[] = [];

  // Process in batches of CONCURRENCY
  for (let i = 0; i < hosts.length; i += CONCURRENCY) {
    const batch = hosts.slice(i, i + CONCURRENCY);
    const checks = await Promise.all(
      batch.map(async host => {
        const open = await tryConnect(host, INVERTER_PORT, SCAN_TIMEOUT_MS);
        return open ? host : null;
      })
    );
    for (const host of checks) {
      if (host !== null) results.push({ host });
    }
  }

  return results;
}
