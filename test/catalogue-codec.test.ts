import { describe, expect, it } from 'vitest';
import { decodeSetting, encodeSetting, timeToInt, validateTime } from '../src/catalogue/codec.js';
import type {
  BooleanSetting,
  EnumSetting,
  IntegerSetting,
  PercentSetting,
  TimeSetting,
} from '../src/catalogue/types.js';

const flag = { register: 27, kind: 'boolean', description: 'x' } as const satisfies BooleanSetting;
const percent = { register: 110, kind: 'percent', min: 4, max: 100, description: 'x' } as const satisfies PercentSetting;
const voltage = {
  register: 51,
  kind: 'integer',
  min: 0,
  max: 500,
  scale: 10,
  unit: 'V',
  description: 'x',
} as const satisfies IntegerSetting;
const plainInteger = { register: 52, kind: 'integer', min: 0, max: 10, description: 'x' } as const satisfies IntegerSetting;
const calibration = {
  register: 29,
  kind: 'enum',
  values: { stop: 0, start: 1, charge: 3, finish: 7 },
  writableValues: ['stop', 'start'],
  description: 'x',
} as const satisfies EnumSetting;
const mode = { register: 50, kind: 'enum', values: { off: 0, on: 1 }, description: 'x' } as const satisfies EnumSetting;
const time = { register: 94, kind: 'time', description: 'x' } as const satisfies TimeSetting;

describe('boolean settings', () => {
  it('decodes 0 as false and 1 as true', () => {
    expect(decodeSetting(flag, 0)).toBe(false);
    expect(decodeSetting(flag, 1)).toBe(true);
  });

  it('decodes any non-zero raw value as true (firmware sometimes stores other values in flag registers)', () => {
    expect(decodeSetting(flag, 2)).toBe(true);
    expect(decodeSetting(flag, 0xffff)).toBe(true);
  });

  it('encodes true as 1 and false as 0', () => {
    expect(encodeSetting(flag, true)).toBe(1);
    expect(encodeSetting(flag, false)).toBe(0);
  });

  it('rejects a non-boolean with TypeError', () => {
    expect(() => encodeSetting(flag, 1 as unknown as boolean)).toThrow(TypeError);
  });
});

describe('percent settings', () => {
  it('decodes the raw value unchanged, even outside the writable range', () => {
    expect(decodeSetting(percent, 50)).toBe(50);
    // The inverter can report values below `min` (e.g. 0) that we would refuse to write.
    expect(decodeSetting(percent, 0)).toBe(0);
  });

  it('encodes integers within the range', () => {
    expect(encodeSetting(percent, 4)).toBe(4);
    expect(encodeSetting(percent, 100)).toBe(100);
  });

  it('rejects values outside min/max and fractional values with RangeError', () => {
    expect(() => encodeSetting(percent, 101)).toThrow(RangeError);
    expect(() => encodeSetting(percent, 3)).toThrow(RangeError);
    expect(() => encodeSetting(percent, 3.5)).toThrow(RangeError);
    expect(() => encodeSetting(percent, Number.NaN)).toThrow(RangeError);
  });

  it('rejects a non-number with TypeError', () => {
    expect(() => encodeSetting(percent, '50' as unknown as number)).toThrow(TypeError);
  });
});

describe('integer settings', () => {
  it('divides by scale on decode', () => {
    expect(decodeSetting(voltage, 2300)).toBe(230);
    expect(decodeSetting(voltage, 2305)).toBe(230.5);
  });

  it('multiplies by scale on encode', () => {
    expect(encodeSetting(voltage, 230)).toBe(2300);
    expect(encodeSetting(voltage, 230.5)).toBe(2305);
  });

  it('rejects values finer than the scale allows', () => {
    expect(() => encodeSetting(voltage, 230.05)).toThrow(RangeError);
  });

  it('checks min/max in user units, not raw units', () => {
    expect(encodeSetting(voltage, 500)).toBe(5000);
    expect(() => encodeSetting(voltage, 500.1)).toThrow(RangeError);
    expect(() => encodeSetting(voltage, -1)).toThrow(RangeError);
  });

  it('treats a missing scale as 1', () => {
    expect(decodeSetting(plainInteger, 7)).toBe(7);
    expect(encodeSetting(plainInteger, 7)).toBe(7);
    expect(() => encodeSetting(plainInteger, 7.5)).toThrow(RangeError);
  });
});

describe('enum settings', () => {
  it('decodes known raw values to their names', () => {
    expect(decodeSetting(calibration, 0)).toBe('stop');
    expect(decodeSetting(calibration, 7)).toBe('finish');
  });

  it("decodes an unknown raw value as 'unknown'", () => {
    expect(decodeSetting(calibration, 2)).toBe('unknown');
  });

  it('encodes a writable value to its raw number', () => {
    expect(encodeSetting(calibration, 'start')).toBe(1);
    expect(encodeSetting(mode, 'on')).toBe(1);
  });

  it('rejects a known value that is not in writableValues', () => {
    // 'charge' is a state the inverter reports during calibration, not one we may request.
    expect(() => encodeSetting(calibration, 'charge' as 'stop')).toThrow(RangeError);
  });

  it('rejects an unknown key, including the decode-only "unknown"', () => {
    expect(() => encodeSetting(mode, 'auto' as 'on')).toThrow(RangeError);
    expect(() => encodeSetting(mode, 'unknown' as 'on')).toThrow(RangeError);
  });

  it('rejects inherited object keys such as "toString"', () => {
    expect(() => encodeSetting(mode, 'toString' as 'on')).toThrow(RangeError);
    expect(decodeSetting(mode, 5)).toBe('unknown');
  });
});

describe('time settings', () => {
  it('decodes HHMM integers to zero-padded "HH:MM"', () => {
    expect(decodeSetting(time, 1730)).toBe('17:30');
    expect(decodeSetting(time, 0)).toBe('00:00');
    expect(decodeSetting(time, 705)).toBe('07:05');
  });

  it('encodes "HH:MM" to an HHMM integer, accepting a single-digit hour', () => {
    expect(encodeSetting(time, '17:30')).toBe(1730);
    expect(encodeSetting(time, '07:05')).toBe(705);
    expect(encodeSetting(time, '7:05')).toBe(705);
  });

  it('rejects 24:00 and single-digit minutes', () => {
    expect(() => encodeSetting(time, '24:00')).toThrow(RangeError);
    expect(() => encodeSetting(time, '7:5')).toThrow(RangeError);
  });
});

describe('time helpers moved from inverter.ts', () => {
  it('validateTime and timeToInt keep their behaviour', () => {
    expect(() => validateTime('23:59')).not.toThrow();
    expect(() => validateTime('12:60')).toThrow(RangeError);
    expect(timeToInt('23:59')).toBe(2359);
  });
});
