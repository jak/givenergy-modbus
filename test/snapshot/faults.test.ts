import { describe, expect, it } from 'vitest';
import {
  decodeBatteryWarnings,
  decodeInverterFaults,
  decodeThreePhaseFaults,
} from '../../src/snapshot/faults.js';

describe('decodeInverterFaults (single-phase HR 223/224)', () => {
  it('reads HR 223 as the high word and HR 224 as the low word, LSB-first', () => {
    // Bit 11 of the 32-bit word is in HR 224 (the low word).
    expect(decodeInverterFaults(0, 1 << 11)).toEqual(['Hall Sensor Fault']);
    // Bit 0 is "Inverter NTC Fault"; the old MSB-first GivTCP table would have put it at bit 31.
    expect(decodeInverterFaults(0, 1)).toEqual(['Inverter NTC Fault']);
    // Bit 28 is in the high word: 28 − 16 = bit 12 of HR 223.
    expect(decodeInverterFaults(1 << 12, 0)).toEqual(['Backup Overload Fault']);
  });

  it('skips bits no source names, and is empty for zero or unread registers', () => {
    expect(decodeInverterFaults(0xffff, 0).every((name) => name.length > 0)).toBe(true);
    expect(decodeInverterFaults(1 << 0, 0)).toEqual([]); // bit 16: unnamed
    expect(decodeInverterFaults(0, 0)).toEqual([]);
    expect(decodeInverterFaults(undefined, undefined)).toEqual([]);
  });

  it('names every bit the GivEnergy installer app defines (21 bits)', () => {
    expect(decodeInverterFaults(0xffff, 0xffff)).toHaveLength(21);
  });
});

describe('decodeBatteryWarnings (single-phase IR 57)', () => {
  it('decodes LSB-first: bit 0 is under-temperature while charging', () => {
    expect(decodeBatteryWarnings(1)).toEqual(['BMS under-temperature (charge)']);
    expect(decodeBatteryWarnings(1 << 15)).toEqual(['Electricity meter comms fail']);
  });

  it('skips reserved bit 11 and names the other 15', () => {
    expect(decodeBatteryWarnings(1 << 11)).toEqual([]);
    expect(decodeBatteryWarnings(0xffff)).toHaveLength(15);
    expect(decodeBatteryWarnings(undefined)).toEqual([]);
  });
});

describe('decodeThreePhaseFaults (IR 1300–1307)', () => {
  it('decodes each word LSB-first with its own table', () => {
    // MSB-first decoding would read bit 0 of word 0 as "Grid frequency out of range" (bit 15).
    expect(decodeThreePhaseFaults([1, 0, 0, 0, 0, 0, 0, 0])).toEqual(['Battery Voltage High']);
    expect(decodeThreePhaseFaults([1 << 15, 0, 0, 0, 0, 0, 0, 0])).toEqual(['Grid frequency out of range']);
    expect(decodeThreePhaseFaults([0, 0, 0, 0, 1 << 5, 0, 0, 0])).toEqual(['PV1 voltage low']);
    expect(decodeThreePhaseFaults([0, 0, 0, 0, 0, 0, 0, 1 << 2])).toEqual(['Meter comms loss']);
  });

  it('treats unread words as zero', () => {
    expect(decodeThreePhaseFaults([undefined, 1 << 15])).toEqual(['No Grid connection']);
    expect(decodeThreePhaseFaults([])).toEqual([]);
  });
});
