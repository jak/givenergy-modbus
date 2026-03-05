/**
 * Binary codec for GivEnergy's Modbus protocol.
 *
 * All multi-byte integers are big-endian (network byte order).
 * Strings are encoded as latin1 and left-padded with '*' to exact length —
 * this is a GivEnergy-specific quirk, not standard Modbus.
 *
 * Reference: GivTCP/givenergy_modbus_async/codec.py
 */

export class PayloadEncoder {
  private buffers: Buffer[] = [];

  addUint8(value: number): void {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(value);
    this.buffers.push(buf);
  }

  addUint16(value: number): void {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(value);
    this.buffers.push(buf);
  }

  addUint32(value: number): void {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value);
    this.buffers.push(buf);
  }

  addUint64(value: bigint): void {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(value);
    this.buffers.push(buf);
  }

  /**
   * Encode a string as latin1, left-padded with '*' to exactly `length` bytes.
   *
   * GivEnergy quirk: strings are right-aligned within a fixed-width field,
   * with '*' as the pad character. If the string is longer than `length`,
   * the leftmost characters are truncated (last N chars kept).
   *
   * Python equivalent: f'{value[-length:]:*>{length}}'.encode()
   */
  addString(value: string, length: number): void {
    const truncated = value.slice(-length);
    const padded = truncated.padStart(length, '*');
    this.buffers.push(Buffer.from(padded, 'latin1'));
  }

  /**
   * Modbus CRC-16 (polynomial 0xA001) of the current payload.
   * Used for request checksums in GivEnergy's transparent sub-frames.
   */
  get crc(): number {
    return crc16Modbus(this.payload);
  }

  get payload(): Buffer {
    return Buffer.concat(this.buffers);
  }

  reset(): void {
    this.buffers = [];
  }
}

export class PayloadDecoder {
  private readonly buffer: Buffer;
  private pointer = 0;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  decodeUint8(): number {
    const val = this.buffer.readUInt8(this.pointer);
    this.pointer += 1;
    return val;
  }

  decodeUint16(): number {
    const val = this.buffer.readUInt16BE(this.pointer);
    this.pointer += 2;
    return val;
  }

  decodeInt16(): number {
    const val = this.buffer.readInt16BE(this.pointer);
    this.pointer += 2;
    return val;
  }

  decodeUint32(): number {
    const val = this.buffer.readUInt32BE(this.pointer);
    this.pointer += 4;
    return val;
  }

  decodeUint64(): bigint {
    const val = this.buffer.readBigUInt64BE(this.pointer);
    this.pointer += 8;
    return val;
  }

  decodeString(length: number): string {
    const val = this.buffer.subarray(this.pointer, this.pointer + length).toString('latin1');
    this.pointer += length;
    return val;
  }

  get remainingBytes(): number {
    return this.buffer.length - this.pointer;
  }

  get decodedBytes(): number {
    return this.pointer;
  }

  get isComplete(): boolean {
    return this.pointer >= this.buffer.length;
  }

  get remainingPayload(): Buffer {
    return this.buffer.subarray(this.pointer);
  }
}

/**
 * Modbus CRC-16 using polynomial 0xA001 (reflected representation of 0x8005).
 * Standard algorithm used by all Modbus implementations.
 */
function crc16Modbus(data: Buffer): number {
  let crc = 0xFFFF;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 1) {
        crc = (crc >> 1) ^ 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc;
}
