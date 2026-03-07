import { describe, it, expect } from 'vitest';
import {
  toMilli,
  toDeci,
  toCenti,
  toPowerFactor,
  toUint32,
  toInt16,
  registersToString,
  toDuint8,
  toTimeslot,
  frequencyScale,
  hvCapacityUsable,
} from '../src/model/converters.js';

describe('Register Converters', () => {
  describe('toMilli', () => {
    it('divides raw register value by 1000', () => {
      // Battery cell voltages (IR 60-75) are stored in millivolts.
      // A raw value of 3250 means 3.250V.
      expect(toMilli(3250)).toBeCloseTo(3.25);
    });

    it('returns 0 for 0', () => {
      expect(toMilli(0)).toBe(0);
    });
  });

  describe('toDeci', () => {
    it('divides raw register value by 10', () => {
      // PV voltage (IR 1) is stored in tenths of a volt.
      // A raw value of 3125 means 312.5V.
      expect(toDeci(3125)).toBeCloseTo(312.5);
    });
  });

  describe('toCenti', () => {
    it('divides raw register value by 100', () => {
      // Battery voltage (IR 50) is stored in hundredths of a volt.
      // A raw value of 5120 means 51.20V.
      expect(toCenti(5120)).toBeCloseTo(51.20);
    });
  });

  describe('toPowerFactor', () => {
    it('converts signed int16 ÷ 10000 for -1.0..1.0 range', () => {
      // Verified against GivEnergy cloud CSV export.
      // CT meter PF registers store signed int16 × 10000.
      // GivTCP uses toMilli (÷1000), but ÷10000 matches the GivEnergy cloud CSV export.
      expect(toPowerFactor(9979)).toBeCloseTo(0.9979, 4);
      expect(toPowerFactor(9970)).toBeCloseTo(0.9970, 4);
    });

    it('handles negative power factor (import direction)', () => {
      // Raw 0xDF13 = 57107 unsigned, but int16 = -8429 → PF = -0.8429
      expect(toPowerFactor(57107)).toBeCloseTo(-0.8429, 4);
    });

    it('handles unity power factor', () => {
      expect(toPowerFactor(10000)).toBeCloseTo(1.0, 4);
    });

    it('handles zero power factor', () => {
      expect(toPowerFactor(0)).toBe(0);
    });
  });

  describe('toUint32', () => {
    it('combines two 16-bit registers into a 32-bit unsigned value (high word first)', () => {
      // Energy totals span two registers: high word first, low word second.
      // e_pv_total uses IR(11) as high and IR(12) as low.
      expect(toUint32(0x0001, 0x0002)).toBe(0x00010002);
    });

    it('handles large values', () => {
      expect(toUint32(0xFFFF, 0xFFFF)).toBe(0xFFFFFFFF);
    });

    it('handles zero', () => {
      expect(toUint32(0, 0)).toBe(0);
    });
  });

  describe('toInt16', () => {
    it('interprets 16-bit value as signed two\'s complement', () => {
      // Battery power (IR 52) and grid power (IR 30) can be negative.
      // 0xFFFF = -1, 0xFF9C = -100.
      expect(toInt16(0xFFFF)).toBe(-1);
      expect(toInt16(0xFF9C)).toBe(-100);
    });

    it('leaves positive values unchanged', () => {
      expect(toInt16(100)).toBe(100);
      expect(toInt16(0x7FFF)).toBe(32767);
    });

    it('handles zero', () => {
      expect(toInt16(0)).toBe(0);
    });
  });

  describe('registersToString', () => {
    it('converts array of 16-bit register values to ASCII string (2 chars per register)', () => {
      // Serial numbers (HR 13-17) are stored as 5 registers, 2 chars each.
      // "CE1234G567" → [0x4345, 0x3132, 0x3334, 0x4735, 0x3637]
      const registers = [0x4345, 0x3132, 0x3334, 0x4735, 0x3637];
      expect(registersToString(registers)).toBe('CE1234G567');
    });

    it('handles null-byte registers for battery validity check', () => {
      // Battery.is_valid() checks serial_number is not all null bytes.
      // Null registers: [0x0000 × 5] → all null chars
      const registers = [0x0000, 0x0000, 0x0000, 0x0000, 0x0000];
      expect(registersToString(registers)).toBe('\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00');
    });
  });

  describe('toDuint8', () => {
    it('splits a 16-bit register into two 8-bit values [high, low]', () => {
      // HR(43) contains charge_soc in high byte and discharge_soc in low byte.
      // Value 0x6432 → charge=100 (0x64), discharge=50 (0x32)
      const [high, low] = toDuint8(0x6432);
      expect(high).toBe(0x64); // 100
      expect(low).toBe(0x32);  // 50
    });

    it('handles 0x0000', () => {
      const [high, low] = toDuint8(0x0000);
      expect(high).toBe(0);
      expect(low).toBe(0);
    });
  });

  describe('toTimeslot', () => {
    it('converts register pair to time range with HH:MM formatting', () => {
      // Charge/discharge slots: start in one register, end in next.
      // Value format: HHMM as integer. 30 = 00:30, 430 = 04:30
      const slot = toTimeslot(30, 430);
      expect(slot.start).toBe('00:30');
      expect(slot.end).toBe('04:30');
    });

    it('handles midnight and end-of-day', () => {
      const slot = toTimeslot(0, 2359);
      expect(slot.start).toBe('00:00');
      expect(slot.end).toBe('23:59');
    });

    it('formats single-digit minutes correctly', () => {
      const slot = toTimeslot(100, 105);
      expect(slot.start).toBe('01:00');
      expect(slot.end).toBe('01:05');
    });

    it('normalises 2400 to 00:00 — some firmware stores midnight as 2400 instead of 0', () => {
      // See #4 — some firmware stores midnight as 2400, which produces "24:00".
      // We normalise silently since the intent is unambiguous.
      const slot = toTimeslot(2400, 2400);
      expect(slot.start).toBe('00:00');
      expect(slot.end).toBe('00:00');
    });

    it('normalises 2400 in either start or end position', () => {
      const slot = toTimeslot(0, 2400);
      expect(slot.start).toBe('00:00');
      expect(slot.end).toBe('00:00');
    });
  });

  describe('frequencyScale', () => {
    it('divides by 10 when centi-Hz value > 100', () => {
      // GivEnergy firmware inconsistency: some versions report AC frequency
      // in centi-Hz (e.g. 5000 = 50.00Hz → after /10 = 500 = 50.0Hz),
      // others in deci-Hz (e.g. 500 = 50.0Hz → after /10 = 50Hz).
      // Python: if f_ac1 > 100: freq = f_ac1 / 10
      // Note: this applies the rule once; callers apply toDeci on top for Hz.
      expect(frequencyScale(5000)).toBeCloseTo(500);
      expect(frequencyScale(500)).toBeCloseTo(50);
    });

    it('leaves values <= 100 unchanged', () => {
      // Already in Hz (some newer firmware)
      expect(frequencyScale(50)).toBe(50);
      expect(frequencyScale(60)).toBe(60);
    });

    it('handles the boundary value 100 — no scaling', () => {
      expect(frequencyScale(100)).toBe(100);
    });
  });

  describe('hvCapacityUsable', () => {
    it('applies 0.9x multiplier for HV battery usable capacity', () => {
      // GivEnergy HV batteries report nominal capacity per module, but only
      // 90% of the aggregated capacity is usable by the system.
      // The BMS reserves 10% as a hardware protection buffer.
      // Python: round((nominal_capacity * num_modules) * 0.9, 2)
      expect(hvCapacityUsable(13.5, 3)).toBeCloseTo(36.45, 2);
    });

    it('handles single module', () => {
      expect(hvCapacityUsable(10.0, 1)).toBeCloseTo(9.0, 2);
    });

    it('rounds to 2 decimal places', () => {
      // Python uses round(..., 2)
      expect(hvCapacityUsable(13.5, 4)).toBeCloseTo(48.6, 2);
    });
  });
});
