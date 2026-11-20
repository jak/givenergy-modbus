import type { SettingDefinition, ValueOf, WriteValueOf } from './types.js';

/** Converts `"HH:MM"` to the inverter's HHMM integer. Call {@link validateTime} first. */
export function timeToInt(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 100 + m;
}

/**
 * Throws `RangeError` unless `time` is `"H:MM"` or `"HH:MM"` with hour 0-23 and minute 0-59.
 * A single-digit hour is accepted; minutes must always have two digits.
 */
export function validateTime(time: string): void {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError(`invalid time format "${time}", expected "HH:MM"`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new RangeError(`invalid time "${time}", hour must be 0-23 and minute 0-59`);
}

function intToTime(raw: number): string {
  const h = Math.floor(raw / 100);
  const m = raw % 100;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireNumber(value: unknown): number {
  if (typeof value !== 'number') throw new TypeError(`expected a number, got ${typeof value}`);
  return value;
}

function checkRange(value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`value must be between ${min} and ${max}, got ${value}`);
  }
}

/** Converts a raw holding-register value to the setting's user-facing value. */
export function decodeSetting<D extends SettingDefinition>(definition: D, raw: number): ValueOf<D> {
  return decode(definition, raw) as ValueOf<D>;
}

function decode(definition: SettingDefinition, raw: number): boolean | number | string {
  switch (definition.kind) {
    case 'boolean':
      return raw !== 0;
    case 'percent':
      return raw;
    case 'integer':
      return raw / (definition.scale ?? 1);
    case 'enum': {
      for (const [name, value] of Object.entries(definition.values)) {
        if (value === raw) return name;
      }
      return 'unknown';
    }
    case 'time':
      return intToTime(raw);
  }
}

/**
 * Converts a user-facing value to the raw holding-register value, validating it first.
 * Throws `TypeError` for the wrong JavaScript type and `RangeError` for an invalid or out-of-range value.
 */
export function encodeSetting<D extends SettingDefinition>(definition: D, value: WriteValueOf<D>): number {
  return encode(definition, value);
}

function encode(definition: SettingDefinition, value: unknown): number {
  switch (definition.kind) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new TypeError(`expected a boolean, got ${typeof value}`);
      return value ? 1 : 0;
    case 'percent': {
      const percent = requireNumber(value);
      checkRange(percent, definition.min, definition.max);
      if (!Number.isInteger(percent)) throw new RangeError(`value must be a whole number, got ${percent}`);
      return percent;
    }
    case 'integer': {
      const number = requireNumber(value);
      checkRange(number, definition.min, definition.max);
      const scale = definition.scale ?? 1;
      const raw = Math.round(number * scale);
      // Compare after rounding so 230.5 * 10 (floating point 2305.0000000000005) is accepted
      // while 230.05 * 10 (2300.5) is rejected as finer than the register resolution.
      if (Math.abs(raw - number * scale) > 1e-9) {
        throw new RangeError(`value ${number} has more precision than the register allows (scale ${scale})`);
      }
      return raw;
    }
    case 'enum': {
      if (typeof value !== 'string') throw new TypeError(`expected a string, got ${typeof value}`);
      if (!hasOwn(definition.values, value)) {
        throw new RangeError(`unknown value "${value}", expected one of ${Object.keys(definition.values).join(', ')}`);
      }
      if (definition.writableValues && !definition.writableValues.includes(value)) {
        throw new RangeError(`value "${value}" cannot be written, expected one of ${definition.writableValues.join(', ')}`);
      }
      return definition.values[value];
    }
    case 'time':
      if (typeof value !== 'string') throw new TypeError(`expected a string, got ${typeof value}`);
      validateTime(value);
      return timeToInt(value);
  }
}
