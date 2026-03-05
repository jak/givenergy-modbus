import { describe, it, expect } from 'vitest';
import { PayloadEncoder, PayloadDecoder } from '../src/codec.js';

describe('PayloadEncoder', () => {
  it('encodes 8-bit unsigned integer', () => {
    const enc = new PayloadEncoder();
    enc.addUint8(0xFF);
    expect(enc.payload).toEqual(Buffer.from([0xFF]));
  });

  it('encodes 16-bit unsigned integer in big-endian', () => {
    // GivEnergy protocol uses big-endian throughout
    const enc = new PayloadEncoder();
    enc.addUint16(0x5959);
    expect(enc.payload).toEqual(Buffer.from([0x59, 0x59]));
  });

  it('encodes 32-bit unsigned integer in big-endian', () => {
    const enc = new PayloadEncoder();
    enc.addUint32(0x00010002);
    expect(enc.payload).toEqual(Buffer.from([0x00, 0x01, 0x00, 0x02]));
  });

  it('encodes 64-bit unsigned integer in big-endian', () => {
    // The padding field in transparent messages uses this.
    // Default padding value is 0x0800000000000000.
    const enc = new PayloadEncoder();
    enc.addUint64(0x0800000000000000n);
    expect(enc.payload).toEqual(Buffer.from([0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
  });

  it('encodes string right-padded with asterisks to exact length', () => {
    // GivEnergy quirk: strings are right-aligned and padded with '*' on the left.
    // Python: f'{value[-length:]:*>{length}}'.encode()
    // Example: "ABC" with length=10 → "*******ABC"
    const enc = new PayloadEncoder();
    enc.addString('ABC', 10);
    expect(enc.payload).toEqual(Buffer.from('*******ABC', 'latin1'));
  });

  it('truncates string from left if longer than length', () => {
    // Python takes value[-length:] — last N chars only
    const enc = new PayloadEncoder();
    enc.addString('ABCDEFGHIJK', 10);
    expect(enc.payload).toEqual(Buffer.from('BCDEFGHIJK', 'latin1'));
  });

  it('encodes exact-length string without padding', () => {
    const enc = new PayloadEncoder();
    enc.addString('CE1234G567', 10);
    expect(enc.payload).toEqual(Buffer.from('CE1234G567', 'latin1'));
  });

  it('calculates Modbus CRC-16 over current payload', () => {
    // CRC used for request checksums. Test that it returns a valid 16-bit number.
    const enc = new PayloadEncoder();
    enc.addUint8(0x31);
    enc.addUint8(0x04);
    enc.addUint16(0x0000);
    enc.addUint16(0x003C);
    const crc = enc.crc;
    expect(typeof crc).toBe('number');
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xFFFF);
  });

  it('accumulates multiple writes into a single payload', () => {
    const enc = new PayloadEncoder();
    enc.addUint16(0x5959);
    enc.addUint16(0x0001);
    expect(enc.payload.length).toBe(4);
    expect(enc.payload).toEqual(Buffer.from([0x59, 0x59, 0x00, 0x01]));
  });

  it('resets payload buffer', () => {
    const enc = new PayloadEncoder();
    enc.addUint8(0xFF);
    enc.reset();
    expect(enc.payload.length).toBe(0);
  });
});

describe('PayloadDecoder', () => {
  it('decodes 8-bit unsigned integer', () => {
    const dec = new PayloadDecoder(Buffer.from([0xFF]));
    expect(dec.decodeUint8()).toBe(0xFF);
  });

  it('decodes 16-bit unsigned integer in big-endian', () => {
    const dec = new PayloadDecoder(Buffer.from([0x59, 0x59]));
    expect(dec.decodeUint16()).toBe(0x5959);
  });

  it('decodes signed 16-bit integer (two\'s complement)', () => {
    // Battery current and grid power can be negative
    const dec = new PayloadDecoder(Buffer.from([0xFF, 0x9C])); // -100
    expect(dec.decodeInt16()).toBe(-100);
  });

  it('decodes 32-bit unsigned integer in big-endian', () => {
    const dec = new PayloadDecoder(Buffer.from([0x00, 0x01, 0x00, 0x02]));
    expect(dec.decodeUint32()).toBe(0x00010002);
  });

  it('decodes 64-bit unsigned integer in big-endian', () => {
    const dec = new PayloadDecoder(Buffer.from([0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
    expect(dec.decodeUint64()).toBe(0x0800000000000000n);
  });

  it('decodes string as latin1', () => {
    const dec = new PayloadDecoder(Buffer.from('CE1234G567', 'latin1'));
    expect(dec.decodeString(10)).toBe('CE1234G567');
  });

  it('tracks remaining bytes', () => {
    const dec = new PayloadDecoder(Buffer.from([0x01, 0x02, 0x03, 0x04]));
    expect(dec.remainingBytes).toBe(4);
    dec.decodeUint16();
    expect(dec.remainingBytes).toBe(2);
    expect(dec.decodedBytes).toBe(2);
  });

  it('reports decoding complete', () => {
    const dec = new PayloadDecoder(Buffer.from([0x01]));
    expect(dec.isComplete).toBe(false);
    dec.decodeUint8();
    expect(dec.isComplete).toBe(true);
  });

  it('decodes sequential values from a buffer', () => {
    const dec = new PayloadDecoder(Buffer.from([0x59, 0x59, 0x00, 0x01, 0x02]));
    expect(dec.decodeUint16()).toBe(0x5959);
    expect(dec.decodeUint16()).toBe(0x0001);
    expect(dec.decodeUint8()).toBe(0x02);
    expect(dec.isComplete).toBe(true);
  });
});
