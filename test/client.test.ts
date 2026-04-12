import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'net';
import { Client } from '../src/client.js';

// Build a fake read request frame for testing
function fakeReadRequest(slave: number, base: number, count: number): Buffer {
  // Minimal transparent frame: header(8) + serial(10) + padding(8) + slave+fc+base+count+crc
  const serial = Buffer.alloc(10, 0x2a); // 10 '*' chars
  const padding = Buffer.from([0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const sub = Buffer.from([
    slave, 0x04,
    (base >> 8) & 0xFF, base & 0xFF,
    (count >> 8) & 0xFF, count & 0xFF,
    0x00, 0x00, // crc placeholder
  ]);
  const body = Buffer.concat([serial, padding, sub]);
  const payloadLen = body.length + 2;
  return Buffer.from([
    0x59, 0x59, 0x00, 0x01,
    (payloadLen >> 8) & 0xFF, payloadLen & 0xFF,
    0x01, 0x02,
    ...Array.from(body),
  ]);
}

// Build a minimal heartbeat request frame (what the inverter sends to us)
function buildHeartbeatRequestFrame(serial: string): Buffer {
  const serialBuf = Buffer.from(serial.padStart(10, '*'), 'latin1');
  const payloadLen = 2 + 10 + 1; // uid + fid + serial + type = 13
  return Buffer.from([
    0x59, 0x59, 0x00, 0x01,
    (payloadLen >> 8) & 0xFF, payloadLen & 0xFF,
    0x01, 0x01, // uid=1, fid=1 (heartbeat)
    ...Array.from(serialBuf),
    0x00, // data_adapter_type
  ]);
}

// Wait for server to accept a connection (poll serverSockets array)
function waitForServerSocket(serverSockets: Socket[], timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (serverSockets.length > 0) {
        resolve(serverSockets[0]);
      } else if (Date.now() >= deadline) {
        reject(new Error('timeout waiting for server socket'));
      } else {
        setImmediate(poll);
      }
    };
    poll();
  });
}

// Wait for data to arrive on a socket
function waitForData(socket: Socket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for data')), timeoutMs);
    socket.once('data', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Client', () => {
  let server: Server;
  let serverPort: number;
  let serverSockets: Socket[];

  beforeEach(async () => {
    serverSockets = [];
    server = createServer(socket => serverSockets.push(socket));
    await new Promise<void>(resolve => {
      server.listen(0, () => {
        serverPort = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    serverSockets.forEach(s => s.destroy());
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('connects to inverter on specified host and port', async () => {
    const client = new Client({ host: '127.0.0.1', port: serverPort });
    await client.connect();
    // Client 'connect' can fire before server's 'connection' event is processed;
    // wait for the server side to catch up before asserting.
    await waitForServerSocket(serverSockets, 1000);
    expect(serverSockets.length).toBe(1);
    await client.close();
  });

  it('responds to heartbeat frame sent by inverter', async () => {
    // The inverter sends HeartbeatRequest every ~3 minutes.
    // If the client doesn't respond within 5 seconds, the TCP connection drops.
    // Heartbeat response bypasses the 250ms TX throttle for immediate delivery.
    const client = new Client({ host: '127.0.0.1', port: serverPort });
    await client.connect();

    // Wait for server to accept the connection before sending data
    const serverSocket = await waitForServerSocket(serverSockets, 1000);

    const heartbeatReq = buildHeartbeatRequestFrame('CE1234G567');
    serverSocket.write(heartbeatReq);

    const response = await waitForData(serverSocket, 1000);
    expect(response).toBeDefined();
    expect(response[7]).toBe(0x01); // function code: heartbeat

    await client.close();
  });

  it('rejects sendRequest if not connected', async () => {
    const client = new Client({ host: '127.0.0.1', port: serverPort });
    await expect(
      client.sendRequest(fakeReadRequest(0x31, 0, 60))
    ).rejects.toThrow();
  });

  it('times out and rejects sendRequest when no response arrives', async () => {
    // Server accepts the connection but never responds.
    // Client should timeout and reject the promise.
    const client = new Client({
      host: '127.0.0.1', port: serverPort,
      retries: 0, timeout: 100,
    });
    await client.connect();

    const start = Date.now();
    await expect(
      client.sendRequest(fakeReadRequest(0x31, 0, 60))
    ).rejects.toThrow();
    const elapsed = Date.now() - start;
    // Timer resolution means elapsed can be slightly under the nominal timeout
    expect(elapsed).toBeGreaterThanOrEqual(90);

    await client.close();
  });

  it('does not crash when server sends a short frame that decodePdu cannot parse', async () => {
    // A malicious or buggy device could send a frame with valid MBAP header but
    // a body too short for decodePdu (which reads fixed offsets up to byte 41).
    // The client must catch the decode error instead of crashing the process.
    const client = new Client({
      host: '127.0.0.1', port: serverPort,
      retries: 0, timeout: 500,
    });
    await client.connect();

    const serverSocket = await waitForServerSocket(serverSockets, 1000);

    // Construct a frame with valid MBAP header but only 14 bytes of body
    // (fid=0x02 transparent, but body far too short for decodePdu offsets 38-41)
    const shortFrame = Buffer.from([
      0x59, 0x59, 0x00, 0x01, // tid + pid
      0x00, 0x0e,             // length=14 (total frame = 20 bytes)
      0x01, 0x02,             // uid=1, fid=2 (transparent)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    serverSocket.write(shortFrame);

    // Client should not crash — sendRequest should simply time out
    await expect(
      client.sendRequest(fakeReadRequest(0x31, 0, 60))
    ).rejects.toThrow('timeout');

    await client.close();
  });

  it('rejects connect() within timeout when host silently drops packets', async () => {
    // Issue #35: a silently-blackholed host (WiFi dongle offline, firewall drop)
    // must not cause connect() to hang past the configured timeout.
    // 192.0.2.1 is TEST-NET-1 (RFC 5737) — reserved, non-routable, typically drops.
    // We accept either a connect-timeout or an unreachable error; the contract
    // being tested is "does not hang indefinitely".
    const client = new Client({
      host: '192.0.2.1', port: 1,
      timeout: 200,
    });

    const start = Date.now();
    await expect(client.connect()).rejects.toThrow();
    const elapsed = Date.now() - start;

    // Must reject well before the OS-level TCP connect timeout (~75s).
    // Give generous headroom for CI jitter / unreachable-error paths.
    expect(elapsed).toBeLessThan(2000);
  });

  it('emits debug events for connect start and success', async () => {
    const debugMessages: string[] = [];
    const client = new Client({
      host: '127.0.0.1', port: serverPort,
      onDebug: msg => debugMessages.push(msg),
    });
    await client.connect();

    expect(debugMessages.some(m => m.includes('connecting to 127.0.0.1'))).toBe(true);
    expect(debugMessages.some(m => m.includes('connected'))).toBe(true);

    await client.close();
  });

  it('retries on timeout up to configured count', async () => {
    // Python: while tries <= retries: send, wait timeout, sleep(0.5), retry
    // Default: retries=5. Here we use retries=2 to keep test fast.
    // Total time >= retries × (timeout + 500ms sleep between retries)
    const client = new Client({
      host: '127.0.0.1', port: serverPort,
      retries: 2, timeout: 50,
    });
    await client.connect();

    const start = Date.now();
    await expect(
      client.sendRequest(fakeReadRequest(0x31, 0, 60))
    ).rejects.toThrow();
    const elapsed = Date.now() - start;

    // With retries=2: initial(50ms) + sleep(500ms) + retry1(50ms) + sleep(500ms) + retry2(50ms)
    // At minimum ~1000ms+ but we check a conservative threshold
    expect(elapsed).toBeGreaterThan(900);

    await client.close();
  });
});
