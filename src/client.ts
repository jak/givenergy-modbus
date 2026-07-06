import { createConnection, type Socket } from 'net';
import { Framer } from './framer.js';
import { shapeHash } from './shape-hash.js';
import { decodePdu } from './pdu/decode.js';
import { encodeHeartbeatResponse } from './pdu/heartbeat.js';
import type { TransparentPdu } from './pdu/types.js';

export interface ClientOptions {
  host: string;
  port?: number;        // default 8899
  timeout?: number;     // ms, default 4000
  retries?: number;     // default 5
  onDebug?: (msg: string) => void;
  /** Called for every transparent response with register data (fc=3 or fc=4), matched or not */
  onRegisterData?: (slave: number, fc: number, base: number, values: number[]) => void;
}

interface PendingRequest {
  resolve: (values: number[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Client {
  private readonly host: string;
  private readonly port: number;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly onDebug: (msg: string) => void;
  private readonly onRegisterData: (slave: number, fc: number, base: number, values: number[]) => void;

  private socket: Socket | null = null;
  private framer = new Framer();
  private pending = new Map<string, PendingRequest>();
  private txQueue: Buffer[] = [];
  private txDraining = false;
  private _dataAdapterSerial = '**********';

  /** The data adapter serial, learned from the first heartbeat */
  get dataAdapterSerial(): string {
    return this._dataAdapterSerial;
  }

  constructor(options: ClientOptions) {
    this.host = options.host;
    this.port = options.port ?? 8899;
    this.timeout = options.timeout ?? 4000;
    this.retries = options.retries ?? 5;
    this.onDebug = options.onDebug ?? (() => {});
    this.onRegisterData = options.onRegisterData ?? (() => {});
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.onDebug(`connecting to ${this.host}:${this.port} (timeout ${this.timeout}ms)`);
      const socket = createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);

      // Guard against silent SYN drops (WiFi dongle offline, firewall blackhole).
      // Without this the OS-level TCP timeout (~75s) is the only backstop.
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`connect timeout after ${this.timeout}ms to ${this.host}:${this.port}`));
      }, this.timeout);

      const onError = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.off('error', onError);
        this.onDebug(`connected to ${this.host}:${this.port}`);
        this.socket = socket;
        socket.on('data', (data: Buffer) => this._onData(data));
        // On transport death, fail pending requests AND drop the socket reference so
        // subsequent sendRequest() calls fast-fail with 'not connected' instead of
        // writing into a dead socket and waiting out full timeouts. This is what lets
        // the PollManager detect the drop and trigger its reconnect loop.
        // Guard with `this.socket === socket` so a late close from a stale socket can't
        // null out a freshly reconnected one.
        socket.on('close', () => {
          this._failAllPending(new Error('connection closed'));
          if (this.socket === socket) this.socket = null;
        });
        socket.on('error', (err) => {
          this._failAllPending(err);
          if (this.socket === socket) this.socket = null;
        });
        resolve();
      });
      socket.once('error', onError);
    });
  }

  async sendRequest(frame: Buffer): Promise<number[]> {
    if (!this.socket) throw new Error('not connected');

    // Frame layout: header(8) + serial(10) + padding(8) + slave(1) + fc(1) + base(2) + count/value(2) + crc(2)
    const slave = frame[26];
    const fc = frame[27];
    const base = (frame[28] << 8) | frame[29];
    const count = (frame[30] << 8) | frame[31];
    // For writes (fc=0x06), bytes 30-31 are the value, not a count.
    // GivTCP's shape hash for writes uses only (slave, fc, register) — not the value.
    const key = fc === 0x06
      ? shapeHash(slave, fc, base, 0)
      : shapeHash(slave, fc, base, count);

    let lastError: Error = new Error('timeout');
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      // Re-check on every attempt: the socket can die mid-cycle (a 'close'/'error'
      // handler nulls it), and there's no point retrying writes into a dead socket.
      if (!this.socket) throw new Error('not connected');
      if (attempt > 0) {
        this.onDebug(`retry ${attempt}/${this.retries} for ${key}`);
        await new Promise(r => setTimeout(r, 500)); // inter-retry delay
      }
      try {
        const result = await this._sendOnce(frame, key);
        return result;
      } catch (err) {
        lastError = err as Error;
        this.onDebug(`attempt ${attempt} failed: ${lastError.message}`);
      }
    }
    throw lastError;
  }

  private _sendOnce(frame: Buffer, key: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const existing = this.pending.get(key);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new Error('superseded by new request'));
      }

      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`timeout waiting for response to ${key}`));
      }, this.timeout);

      this.pending.set(key, { resolve, reject, timer });
      this._enqueue(frame);
    });
  }

  private _enqueue(frame: Buffer): void {
    this.txQueue.push(frame);
    if (!this.txDraining) {
      this._drain();
    }
  }

  private async _drain(): Promise<void> {
    this.txDraining = true;
    while (this.txQueue.length > 0) {
      const frame = this.txQueue.shift()!;
      this.socket?.write(frame);
      if (this.txQueue.length > 0) {
        await new Promise(r => setTimeout(r, 250)); // 250ms throttle between frames
      }
    }
    this.txDraining = false;
  }

  private _onData(data: Buffer): void {
    this.onDebug(`received ${data.length} bytes from inverter`);
    const results = this.framer.decode(data);
    for (const result of results) {
      if (result.type !== 'frame') continue;
      let pdu;
      try {
        pdu = decodePdu(result.data);
      } catch (err) {
        this.onDebug(`failed to decode frame (${(err as Error).message}), skipping`);
        continue;
      }
      if (pdu.type === 'heartbeat') {
        this.onDebug(`heartbeat received (serial=${pdu.dataAdapterSerial}), sending response`);
        this._dataAdapterSerial = pdu.dataAdapterSerial;
        this.socket?.write(encodeHeartbeatResponse(pdu.dataAdapterSerial));
      } else if (pdu.type === 'transparent') {
        this.onDebug(`transparent response received (slave=0x${pdu.slaveAddress.toString(16)}, fc=${pdu.transparentFunctionCode})`);
        this._dispatchResponse(pdu);
      }
    }
  }

  private _dispatchResponse(pdu: TransparentPdu): void {
    // Always forward register data to the cache — even unsolicited push data is useful
    const fc = pdu.transparentFunctionCode;
    if (!pdu.error && (fc === 3 || fc === 4 || fc === 22) && pdu.registerValues.length > 0) {
      this.onRegisterData(pdu.slaveAddress, fc, pdu.baseRegister, pdu.registerValues);
    }

    // Also resolve any pending request waiting for this exact response shape.
    // For writes (fc=0x06), use 0 for count to match the request key.
    // Gen1 BPM responds with fc=134 (0x86) instead of fc=6 — normalize to match.
    const normalizedFc = fc === 134 ? 0x06 : fc;
    const isWrite = normalizedFc === 0x06;
    const key = isWrite
      ? shapeHash(pdu.slaveAddress, normalizedFc, pdu.baseRegister, 0)
      : shapeHash(pdu.slaveAddress, normalizedFc, pdu.baseRegister, pdu.registerCount);
    const pending = this.pending.get(key);
    if (!pending) {
      this.onDebug(`received response for ${key} but no pending request found`);
      return;
    }
    this.pending.delete(key);
    clearTimeout(pending.timer);
    if (pdu.error) {
      pending.reject(new Error(`error response for ${key}`));
    } else {
      pending.resolve(pdu.registerValues);
    }
  }

  close(): Promise<void> {
    this._failAllPending(new Error('client closed'));
    return new Promise(resolve => {
      if (!this.socket) { resolve(); return; }
      this.socket.destroy();
      this.socket = null;
      resolve();
    });
  }

  private _failAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}
