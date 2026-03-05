import { describe, it, expect } from 'vitest';
import { shapeHash } from '../src/shape-hash.js';

describe('Shape Hash', () => {
  it('produces the same hash for request and its matching response', () => {
    // GivEnergy doesn't use standard Modbus transaction IDs — tid is always 0x5959.
    // Request and response are matched by shape: same slave, function, base, count.
    const requestHash = shapeHash(0x31, 0x04, 0, 60);
    const responseHash = shapeHash(0x31, 0x04, 0, 60);
    expect(requestHash).toBe(responseHash);
  });

  it('distinguishes different slave addresses', () => {
    // Battery 1 (0x32) and battery 2 (0x33) read the same register range
    // but are different devices — must not be confused.
    const bat1 = shapeHash(0x32, 0x04, 60, 60);
    const bat2 = shapeHash(0x33, 0x04, 60, 60);
    expect(bat1).not.toBe(bat2);
  });

  it('distinguishes holding (0x03) vs input (0x04) register reads', () => {
    // Same slave and address range, different function code
    const holding = shapeHash(0x31, 0x03, 0, 60);
    const input = shapeHash(0x31, 0x04, 0, 60);
    expect(holding).not.toBe(input);
  });

  it('distinguishes different register ranges', () => {
    const range1 = shapeHash(0x31, 0x04, 0, 60);
    const range2 = shapeHash(0x31, 0x04, 60, 60);
    expect(range1).not.toBe(range2);
  });

  it('distinguishes write (0x06) from read', () => {
    // Write single holding register uses function code 0x06
    const read = shapeHash(0x11, 0x03, 116, 1);
    const write = shapeHash(0x11, 0x06, 116, 1);
    expect(read).not.toBe(write);
  });

  it('returns a string suitable for use as a Map key', () => {
    const hash = shapeHash(0x31, 0x04, 0, 60);
    expect(typeof hash).toBe('string');
    const map = new Map<string, string>();
    map.set(hash, 'value');
    expect(map.get(shapeHash(0x31, 0x04, 0, 60))).toBe('value');
  });

  it('handles boundary addresses like 0x00 (meter) and 0xA0 (BAM)', () => {
    // Meters use slave addresses 0x01-0x08
    // BAM (Battery Analytics Module for HV systems) uses 0xA0
    const meter = shapeHash(0x01, 0x04, 60, 60);
    const bam = shapeHash(0xA0, 0x04, 60, 5);
    expect(meter).not.toBe(bam);
  });
});
