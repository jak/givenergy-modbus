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

  private socket: Socket | null = null;
  private framer = new Framer();
  private pending = new Map<string, PendingRequest>();
  private txQueue: Buffer[] = [];
  private txDraining = false;
  private dataAdapterSerial = '**********'; // learned from first heartbeat

  constructor(options: ClientOptions) {
    this.host = options.host;
    this.port = options.port ?? 8899;
    this.timeout = options.timeout ?? 4000;
    this.retries = options.retries ?? 5;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      socket.once('connect', () => {
        this.socket = socket;
        resolve();
      });
      socket.once('error', reject);
      socket.on('data', (data: Buffer) => this._onData(data));
      socket.on('close', () => this._failAllPending(new Error('connection closed')));
      socket.on('error', (err) => this._failAllPending(err));
    });
  }

  async sendRequest(frame: Buffer): Promise<number[]> {
    if (!this.socket) throw new Error('not connected');

    // Extract shape hash from the frame for response matching
    // Frame layout: header(8) + serial(10) + padding(8) + slave(1) + fc(1) + base(2) + count(2) + crc(2)
    const slave = frame[26];
    const fc = frame[27];
    const base = (frame[28] << 8) | frame[29];
    const count = (frame[30] << 8) | frame[31];
    const key = shapeHash(slave, fc, base, count);

    let lastError: Error = new Error('timeout');
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 500)); // inter-retry delay
      }
      try {
        const result = await this._sendOnce(frame, key);
        return result;
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw lastError;
  }

  private _sendOnce(frame: Buffer, key: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      // Cancel any existing pending request with same shape
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
        await new Promise(r => setTimeout(r, 250)); // 250ms throttle
      }
    }
    this.txDraining = false;
  }

  private _onData(data: Buffer): void {
    const results = this.framer.decode(data);
    for (const result of results) {
      if (result.type !== 'frame') continue;
      const pdu = decodePdu(result.data);
      if (pdu.type === 'heartbeat') {
        this.dataAdapterSerial = pdu.dataAdapterSerial;
        // Immediate response, bypass queue
        this.socket?.write(encodeHeartbeatResponse(pdu.dataAdapterSerial));
      } else if (pdu.type === 'transparent') {
        this._dispatchResponse(pdu);
      }
    }
  }

  private _dispatchResponse(pdu: TransparentPdu): void {
    const key = shapeHash(pdu.slaveAddress, pdu.transparentFunctionCode, pdu.baseRegister, pdu.registerCount);
    const pending = this.pending.get(key);
    if (!pending) return;
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
