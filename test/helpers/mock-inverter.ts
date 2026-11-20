/**
 * A mock GivEnergy data adapter on a local TCP port, serving register maps per device address.
 *
 * - A read of a device that isn't in `devices` gets no reply, so the request times out, as an
 *   empty battery or meter slot does.
 * - A read of a device that is there answers every requested register, with 0 for registers the
 *   map doesn't hold (real devices answer zeros for unused registers).
 * - `silent(request)` leaves chosen reads unanswered, for blocks a model never answers.
 * - `push()` sends register data unsolicited, as the inverter does in push mode. A push only
 *   resolves a pending request when it has the request's exact base and count.
 * - Writes (function 6) are recorded in `writes` and echoed.
 *
 * Frames carry a zero CRC; the client doesn't check it.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { Framer } from '../../src/framer.js';
import { encodeHeartbeatResponse } from '../../src/pdu/heartbeat.js';

export interface MockDevice {
  holding?: Map<number, number>;
  input?: Map<number, number>;
  /** Function 22 (meter product) registers. */
  product?: Map<number, number>;
}

export interface MockRequest {
  slaveAddress: number;
  functionCode: number;
  baseRegister: number;
  /** The register count, or for a write the value. */
  registerCount: number;
}

export interface MockInverterOptions {
  devices: Map<number, MockDevice>;
  /** Return true to leave this read unanswered. */
  silent?: (request: MockRequest) => boolean;
}

export interface MockInverter {
  port: number;
  /** Every transparent request received, in order, answered or not. */
  requests: MockRequest[];
  writes: Array<{ register: number; value: number }>;
  /** Replaces the `silent` option. */
  silent: (request: MockRequest) => boolean;
  /** Send register data unsolicited to every connected client. */
  push(slaveAddress: number, functionCode: number, baseRegister: number, values: number[]): void;
  /** The registers `device` would answer for `count` registers from `base`. */
  valuesOf(device: MockDevice, functionCode: number, base: number, count: number): number[] | undefined;
  /** Open client connections. */
  connections(): number;
  /** Simulate a transport drop (an inverter reboot or Wi-Fi blip) without closing the server. */
  dropConnections(): void;
  close(): Promise<void>;
}

/** Inverter serial carried in every response frame. */
const INVERTER_SERIAL = 'SA1234B567';
const ADAPTER_SERIAL = 'CE1234G567';

function parseRequest(frame: Buffer): ({ type: 'heartbeat'; dataAdapterSerial: string }) | ({ type: 'transparent' } & MockRequest) | null {
  if (frame.length < 8) return null;
  const fid = frame[7];
  if (fid === 0x01) return { type: 'heartbeat', dataAdapterSerial: frame.subarray(8, 18).toString('latin1') };
  if (fid === 0x02 && frame.length >= 32) {
    return {
      type: 'transparent',
      slaveAddress: frame[26],
      functionCode: frame[27],
      baseRegister: frame.readUInt16BE(28),
      registerCount: frame.readUInt16BE(30),
    };
  }
  return null;
}

export function buildTransparentResponse(slave: number, functionCode: number, baseRegister: number, values: number[]): Buffer {
  const inner: number[] = [
    slave, functionCode,
    ...Buffer.from(INVERTER_SERIAL, 'latin1'),
    (baseRegister >> 8) & 0xff, baseRegister & 0xff,
    (values.length >> 8) & 0xff, values.length & 0xff,
  ];
  for (const value of values) inner.push((value >> 8) & 0xff, value & 0xff);
  inner.push(0x00, 0x00); // CRC placeholder
  const padding = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08];
  const body = Buffer.concat([Buffer.from(ADAPTER_SERIAL, 'latin1'), Buffer.from(padding), Buffer.from(inner)]);
  const length = body.length + 2;
  return Buffer.concat([
    Buffer.from([0x59, 0x59, 0x00, 0x01, (length >> 8) & 0xff, length & 0xff, 0x01, 0x02]),
    body,
  ]);
}

function tableOf(device: MockDevice, functionCode: number): Map<number, number> | undefined {
  if (functionCode === 0x03) return device.holding;
  if (functionCode === 0x04) return device.input;
  if (functionCode === 0x16) return device.product;
  return undefined;
}

export async function startMockInverter(options: MockInverterOptions): Promise<MockInverter> {
  const sockets: Socket[] = [];
  let server!: Server;

  const mock: MockInverter = {
    port: 0,
    requests: [],
    writes: [],
    silent: options.silent ?? (() => false),
    push(slaveAddress, functionCode, baseRegister, values) {
      const frame = buildTransparentResponse(slaveAddress, functionCode, baseRegister, values);
      for (const socket of sockets) socket.write(frame);
    },
    valuesOf(device, functionCode, base, count) {
      const table = tableOf(device, functionCode);
      if (!table) return undefined;
      return Array.from({ length: count }, (_, i) => table.get(base + i) ?? 0);
    },
    connections: () => sockets.length,
    dropConnections() {
      for (const socket of sockets.splice(0)) socket.destroy();
    },
    async close() {
      mock.dropConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  server = createServer((socket) => {
    sockets.push(socket);
    socket.on('close', () => {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    });
    const framer = new Framer();
    socket.on('data', (data: Buffer) => {
      for (const result of framer.decode(data)) {
        if (result.type !== 'frame') continue;
        const request = parseRequest(result.data);
        if (!request) continue;
        if (request.type === 'heartbeat') {
          socket.write(encodeHeartbeatResponse(request.dataAdapterSerial));
          continue;
        }
        const { type: _type, ...read } = request;
        mock.requests.push(read);
        if (read.functionCode === 0x06) {
          mock.writes.push({ register: read.baseRegister, value: read.registerCount });
          socket.write(buildTransparentResponse(read.slaveAddress, 0x06, read.baseRegister, [read.registerCount]));
          continue;
        }
        const device = options.devices.get(read.slaveAddress);
        if (!device || mock.silent(read)) continue;
        const values = mock.valuesOf(device, read.functionCode, read.baseRegister, read.registerCount);
        if (!values) continue;
        socket.write(buildTransparentResponse(read.slaveAddress, read.functionCode, read.baseRegister, values));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mock.port = (server.address() as { port: number }).port;
  return mock;
}

/** Holding (function 3) and input (function 4) reads of the inverter, as `HR 0` / `IR 180` labels. */
export function inverterReads(requests: MockRequest[]): string[] {
  return requests
    .filter((request) => request.slaveAddress === 0x11 && (request.functionCode === 0x03 || request.functionCode === 0x04))
    .map((request) => `${request.functionCode === 0x03 ? 'HR' : 'IR'} ${request.baseRegister}${request.registerCount === 60 ? '' : `/${request.registerCount}`}`);
}
