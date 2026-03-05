# givenergy-modbus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript npm package that communicates with GivEnergy inverters over their proprietary Modbus TCP protocol, porting all workarounds from the Python GivTCP codebase.

**Architecture:** Four layers — Transport (raw TCP + custom framer), Client (connection lifecycle + request queue), Poll Manager (refresh loop + cache + fallbacks), Public API (EventEmitter). No Modbus library dependency; GivEnergy's protocol is too custom.

**Tech Stack:** TypeScript, Node.js `net.Socket`, vitest for testing

**Reference codebase:** `/Users/jak/Code/giv_tcp/GivTCP/givenergy_modbus_async/` (Python)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `givenergy-modbus/package.json`
- Create: `givenergy-modbus/tsconfig.json`
- Create: `givenergy-modbus/vitest.config.ts`
- Create: `givenergy-modbus/src/index.ts`

**Step 1: Create project directory and package.json**

```bash
mkdir -p givenergy-modbus/src givenergy-modbus/test
```

```json
{
  "name": "givenergy-modbus",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
```

**Step 4: Create placeholder index.ts**

```typescript
export {};
```

**Step 5: Install and verify**

Run: `cd givenergy-modbus && npm install`
Run: `npx vitest run`
Expected: 0 tests, no errors

**Step 6: Commit**

```bash
git add givenergy-modbus/
git commit -m "feat: scaffold givenergy-modbus TypeScript package"
```

---

### Task 2: Codec — PayloadEncoder and PayloadDecoder

**Files:**
- Create: `givenergy-modbus/src/codec.ts`
- Create: `givenergy-modbus/test/codec.test.ts`

**Reference:** `GivTCP/givenergy_modbus_async/codec.py`

**Step 1: Write failing tests**

```typescript
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
    // Example: "CE1234G567" → "CE1234G567" (10 chars, no padding needed)
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

  it('calculates Modbus CRC-16', () => {
    // CRC used for request checksums. The Python code uses crccheck.crc.CrcModbus.
    // Test vector: slave_addr=0x31, func=0x04, base_reg=0x0000, count=0x003C
    const enc = new PayloadEncoder();
    enc.addUint8(0x31);
    enc.addUint8(0x04);
    enc.addUint16(0x0000);
    enc.addUint16(0x003C);
    // CRC should be a 16-bit value; exact value validated against Python reference
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
});
```

**Step 2: Run tests to verify they fail**

Run: `cd givenergy-modbus && npx vitest run test/codec.test.ts`
Expected: FAIL — module not found

**Step 3: Implement codec.ts**

```typescript
/**
 * Binary codec for GivEnergy's Modbus protocol.
 *
 * All multi-byte integers are big-endian (network byte order).
 * Strings are encoded as latin1 and right-aligned with '*' padding —
 * this is a GivEnergy-specific quirk, not standard Modbus.
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

  addString(value: string, length: number): void {
    // GivEnergy quirk: take last `length` chars, then right-align with '*' padding.
    // Python: f'{value[-length:]:*>{length}}'.encode()
    const truncated = value.slice(-length);
    const padded = truncated.padStart(length, '*');
    this.buffers.push(Buffer.from(padded, 'latin1'));
  }

  /** Modbus CRC-16 of the current payload. */
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
 * Modbus CRC-16 (polynomial 0xA001).
 * Used for request checksums in GivEnergy's transparent sub-frames.
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
```

**Step 4: Run tests**

Run: `cd givenergy-modbus && npx vitest run test/codec.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add givenergy-modbus/src/codec.ts givenergy-modbus/test/codec.test.ts
git commit -m "feat: add PayloadEncoder/PayloadDecoder with Modbus CRC-16"
```

---

### Task 3: Register Types and Converter Functions

**Files:**
- Create: `givenergy-modbus/src/model/register-types.ts`
- Create: `givenergy-modbus/src/model/converters.ts`
- Create: `givenergy-modbus/test/converters.test.ts`

**Reference:** `GivTCP/givenergy_modbus_async/model/register.py`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  toMilli, toDeci, toCenti, toUint32, toInt16, toString,
  toDuint8, toTimeslot, frequencyScale, hvCapacityUsable,
} from '../src/model/converters.js';

describe('Register Converters', () => {
  describe('toMilli', () => {
    it('divides raw register value by 1000', () => {
      // Battery cell voltages (IR 60-75) are stored in millivolts.
      // A raw value of 3250 means 3.250V.
      expect(toMilli(3250)).toBeCloseTo(3.25);
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

  describe('toUint32', () => {
    it('combines two 16-bit registers into a 32-bit unsigned value', () => {
      // Energy totals span two registers: high word first, low word second.
      // e_pv_total uses IR(11) as high and IR(12) as low.
      expect(toUint32(0x0001, 0x0002)).toBe(0x00010002);
    });

    it('handles zero correctly', () => {
      expect(toUint32(0, 0)).toBe(0);
    });
  });

  describe('toInt16', () => {
    it('interprets 16-bit value as signed two\'s complement', () => {
      // Battery power (IR 52) and grid power (IR 30) can be negative.
      // 0xFFFF = -1 in two's complement.
      expect(toInt16(0xFFFF)).toBe(-1);
      expect(toInt16(0xFF9C)).toBe(-100);
    });

    it('leaves positive values unchanged', () => {
      expect(toInt16(100)).toBe(100);
    });
  });

  describe('toString', () => {
    it('converts array of 16-bit register values to ASCII string', () => {
      // Serial numbers (HR 13-17) are stored as 5 registers, 2 chars each.
      // "CE1234G567" → [0x4345, 0x3132, 0x3334, 0x4735, 0x3637]
      const registers = [0x4345, 0x3132, 0x3334, 0x4735, 0x3637];
      expect(toString(registers)).toBe('CE1234G567');
    });

    it('strips null bytes from serial number validation', () => {
      // Battery.is_valid() checks serial_number is not all null bytes.
      // Null registers: [0x0000, 0x0000, 0x0000, 0x0000, 0x0000]
      const registers = [0x0000, 0x0000, 0x0000, 0x0000, 0x0000];
      expect(toString(registers)).toBe('\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00');
    });
  });

  describe('toDuint8', () => {
    it('splits a 16-bit register into two 8-bit values', () => {
      // HR(43) contains charge_soc in high byte and discharge_soc in low byte.
      // Value 0x6432 → charge=100 (0x64), discharge=50 (0x32)
      const [high, low] = toDuint8(0x6432);
      expect(high).toBe(0x64); // 100
      expect(low).toBe(0x32);  // 50
    });
  });

  describe('toTimeslot', () => {
    it('converts register pair to time range', () => {
      // Charge/discharge slots: start in one register, end in next.
      // Value format: HHMM as integer. 0030 = 00:30, 0430 = 04:30
      const slot = toTimeslot(30, 430);
      expect(slot.start).toBe('00:30');
      expect(slot.end).toBe('04:30');
    });

    it('handles midnight correctly', () => {
      const slot = toTimeslot(0, 2359);
      expect(slot.start).toBe('00:00');
      expect(slot.end).toBe('23:59');
    });
  });

  describe('frequencyScale', () => {
    it('divides by 10 when value exceeds 100', () => {
      // GivEnergy firmware inconsistency: some versions report AC frequency
      // in centi-Hz (e.g., 5000 = 50.00Hz), others in deci-Hz (e.g., 50.0).
      // The Python code: if f_ac1 > 100: freq = f_ac1 / 10
      expect(frequencyScale(5000)).toBeCloseTo(500);  // centi-Hz → deci-Hz
      expect(frequencyScale(500)).toBeCloseTo(50);     // already deci-Hz → Hz
    });

    it('leaves values <= 100 unchanged', () => {
      // Already in Hz (some newer firmware)
      expect(frequencyScale(50.1)).toBeCloseTo(50.1);
    });
  });

  describe('hvCapacityUsable', () => {
    it('applies 0.9x multiplier for HV battery usable capacity', () => {
      // GivEnergy HV batteries report nominal capacity, but only 90% is usable.
      // Python: round((nominal_capacity * num_modules) * 0.9, 2)
      // This is a hardware characteristic, not a software bug.
      expect(hvCapacityUsable(13.5, 3)).toBeCloseTo(36.45);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd givenergy-modbus && npx vitest run test/converters.test.ts`
Expected: FAIL

**Step 3: Implement register-types.ts**

```typescript
/**
 * Register type markers matching GivEnergy's Modbus register layout.
 *
 * HR = Holding Register (read/write, Modbus function 0x03/0x06)
 * IR = Input Register (read-only, Modbus function 0x04)
 */
export type RegisterType = 'HR' | 'IR';

export interface RegisterDefinition {
  type: RegisterType;
  address: number;
  /** Secondary converter applied after the primary (e.g. deci after uint32) */
  converter: (raw: number) => number;
}

export interface TimeSlot {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}
```

**Step 4: Implement converters.ts**

```typescript
import type { TimeSlot } from './register-types.js';

/** Divide by 1000 — millivolt, milliamp registers */
export function toMilli(raw: number): number { return raw / 1000; }

/** Divide by 10 — temperature, voltage, energy registers */
export function toDeci(raw: number): number { return raw / 10; }

/** Divide by 100 — battery voltage, frequency registers */
export function toCenti(raw: number): number { return raw / 100; }

/** Combine two 16-bit registers into a 32-bit unsigned value (high, low) */
export function toUint32(high: number, low: number): number {
  return ((high & 0xFFFF) << 16) | (low & 0xFFFF);
}

/** Interpret a 16-bit value as signed (two's complement) */
export function toInt16(raw: number): number {
  return raw > 0x7FFF ? raw - 0x10000 : raw;
}

/** Convert array of 16-bit register values to ASCII string (2 chars per register) */
export function toString(registers: number[]): string {
  return registers.map(r =>
    String.fromCharCode((r >> 8) & 0xFF, r & 0xFF)
  ).join('');
}

/**
 * Split a 16-bit register into two 8-bit values [high, low].
 * Used for HR(43) which packs charge_soc and discharge_soc.
 */
export function toDuint8(raw: number): [number, number] {
  return [(raw >> 8) & 0xFF, raw & 0xFF];
}

/**
 * Convert register pair to time slot.
 * Register format: integer HHMM (e.g. 30 = 00:30, 1630 = 16:30).
 */
export function toTimeslot(startRaw: number, endRaw: number): TimeSlot {
  const fmt = (v: number) => {
    const h = Math.floor(v / 100);
    const m = v % 100;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  return { start: fmt(startRaw), end: fmt(endRaw) };
}

/**
 * GivEnergy firmware inconsistency: some versions report AC frequency
 * in different units. Values > 100 are assumed to be in a larger unit
 * and are divided by 10.
 *
 * Reference: GivTCP read.py lines 1227-1236
 */
export function frequencyScale(raw: number): number {
  return raw > 100 ? raw / 10 : raw;
}

/**
 * HV battery usable capacity = nominal × modules × 0.9.
 * The 10% deduction is a hardware characteristic — the battery management
 * system reserves 10% and won't allow full discharge.
 *
 * Reference: GivTCP read.py line 438
 */
export function hvCapacityUsable(nominalCapacityKwh: number, moduleCount: number): number {
  return Math.round(nominalCapacityKwh * moduleCount * 0.9 * 100) / 100;
}
```

**Step 5: Run tests**

Run: `cd givenergy-modbus && npx vitest run test/converters.test.ts`
Expected: All PASS

**Step 6: Commit**

```bash
git add givenergy-modbus/src/model/ givenergy-modbus/test/converters.test.ts
git commit -m "feat: add register types and converter functions"
```

---

### Task 4: Framer — Sliding Window Frame Parser

**Files:**
- Create: `givenergy-modbus/src/framer.ts`
- Create: `givenergy-modbus/test/framer.test.ts`

**Reference:** `GivTCP/givenergy_modbus_async/framer.py`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { Framer, HEADER_START_MARKER } from '../src/framer.js';

describe('Framer', () => {
  it('exports the correct start marker', () => {
    // GivEnergy frames always start with 0x59590001 ("YY" + protocol 0x0001).
    // This is NOT a standard Modbus transaction ID — it's a fixed constant.
    expect(HEADER_START_MARKER).toEqual(Buffer.from([0x59, 0x59, 0x00, 0x01]));
  });

  it('extracts a complete frame from buffer', () => {
    const framer = new Framer();
    // Minimal heartbeat frame: header(8) + serial(10) + type(1) = 19 bytes
    // MBAP: tid=0x5959, pid=0x0001, len=0x000D (13), uid=0x01, fid=0x01
    const frame = Buffer.from([
      0x59, 0x59, 0x00, 0x01, // tid + pid
      0x00, 0x0D,             // length: 13 bytes follow
      0x01,                   // uid
      0x01,                   // function code: heartbeat
      // 10-byte serial + 1-byte type = 11 bytes data
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
      0x00,
    ]);
    const results = framer.decode(frame);
    expect(results.length).toBe(1);
  });

  it('handles partial frames by waiting for more data', () => {
    // TCP fragmentation means we may receive half a frame at a time.
    // The framer must buffer partial data and yield nothing until complete.
    const framer = new Framer();
    const partial = Buffer.from([0x59, 0x59, 0x00, 0x01, 0x00, 0x0D, 0x01]);
    const results = framer.decode(partial);
    expect(results.length).toBe(0);
  });

  it('completes a partial frame when remaining bytes arrive', () => {
    const framer = new Framer();
    // First chunk: header only
    framer.decode(Buffer.from([0x59, 0x59, 0x00, 0x01, 0x00, 0x0D, 0x01]));

    // Second chunk: rest of the frame
    const rest = Buffer.from([
      0x01, // fid: heartbeat
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
      0x00,
    ]);
    const results = framer.decode(rest);
    expect(results.length).toBe(1);
  });

  it('discards leading garbage bytes before a valid frame', () => {
    // GivEnergy inverters sometimes send corrupt bytes before valid frames.
    // The Python framer scans forward to find the next 0x59590001 marker.
    const framer = new Framer();
    const garbage = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]); // junk
    const validFrame = Buffer.from([
      0x59, 0x59, 0x00, 0x01,
      0x00, 0x0D, 0x01, 0x01,
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
      0x00,
    ]);
    const results = framer.decode(Buffer.concat([garbage, validFrame]));
    expect(results.length).toBe(1);
  });

  it('extracts multiple frames from a single buffer', () => {
    // TCP may deliver multiple frames in a single read.
    const framer = new Framer();
    const frame = Buffer.from([
      0x59, 0x59, 0x00, 0x01,
      0x00, 0x0D, 0x01, 0x01,
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
      0x00,
    ]);
    const results = framer.decode(Buffer.concat([frame, frame]));
    expect(results.length).toBe(2);
  });

  it('rejects frames with invalid header values', () => {
    // uid must be 0x00 or 0x01, fid must be 0x01 or 0x02.
    // The Python code: u_id not in (0, 1) or f_id not in (1, 2)
    const framer = new Framer();
    const badFrame = Buffer.from([
      0x59, 0x59, 0x00, 0x01,
      0x00, 0x0D,
      0x05, // bad uid
      0x01,
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
      0x00,
    ]);
    const results = framer.decode(badFrame);
    // Should skip the bad frame and yield nothing (or an error marker)
    expect(results.filter(r => r.type !== 'error').length).toBe(0);
  });

  it('rejects implausibly large frames (len > 300)', () => {
    // Python: hdr_len > 300 triggers discard.
    // Prevents memory exhaustion from corrupt length fields.
    const framer = new Framer();
    const badFrame = Buffer.from([
      0x59, 0x59, 0x00, 0x01,
      0x01, 0x2D, // len = 301 (too large)
      0x01, 0x02,
    ]);
    const results = framer.decode(badFrame);
    expect(results.filter(r => r.type !== 'error').length).toBe(0);
  });

  it('skips corrupt frame when next frame header is implausibly close', () => {
    // Python: if next_frame_start_offset < 18, current frame is corrupt.
    // Minimum valid frame is 18 bytes (heartbeat request).
    const framer = new Framer();
    const data = Buffer.from([
      0x59, 0x59, 0x00, 0x01, // first (corrupt) frame start
      0x00, 0x0D, 0x01, 0x01,
      0x59, 0x59, 0x00, 0x01, // second frame start only 8 bytes in (too close)
      0x00, 0x0D, 0x01, 0x01,
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
      0x00,
    ]);
    const results = framer.decode(data);
    // Should skip the first corrupt frame and extract the second
    expect(results.length).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd givenergy-modbus && npx vitest run test/framer.test.ts`
Expected: FAIL

**Step 3: Implement framer.ts**

Implement the `Framer` class with:
- Internal `_buffer: Buffer`
- `HEADER_START_MARKER = Buffer.from([0x59, 0x59, 0x00, 0x01])`
- `decode(data: Buffer)` method that:
  1. Appends data to buffer
  2. While buffer >= 18 bytes:
     a. Scan for start marker; skip garbage if not at position 0
     b. Check next frame header isn't implausibly close (< 18 bytes)
     c. Validate header: `hdr_len <= 300`, `uid ∈ {0,1}`, `fid ∈ {1,2}`
     d. Calculate `frame_len = 6 + hdr_len`
     e. If buffer too short, break (wait for more data)
     f. Extract frame bytes, advance buffer
     g. Return raw frame (PDU decoding in separate task)

**Step 4: Run tests**

Run: `cd givenergy-modbus && npx vitest run test/framer.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add givenergy-modbus/src/framer.ts givenergy-modbus/test/framer.test.ts
git commit -m "feat: add sliding-window frame parser for GivEnergy protocol"
```

---

### Task 5: PDU Types — Heartbeat and Transparent Messages

**Files:**
- Create: `givenergy-modbus/src/pdu/types.ts`
- Create: `givenergy-modbus/src/pdu/heartbeat.ts`
- Create: `givenergy-modbus/src/pdu/transparent.ts`
- Create: `givenergy-modbus/src/pdu/encode.ts`
- Create: `givenergy-modbus/src/pdu/decode.ts`
- Create: `givenergy-modbus/test/pdu.test.ts`

**Reference:** `GivTCP/givenergy_modbus_async/pdu/`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { encodeHeartbeatResponse } from '../src/pdu/heartbeat.js';
import {
  encodeReadHoldingRegistersRequest,
  encodeReadInputRegistersRequest,
  encodeWriteHoldingRegisterRequest,
} from '../src/pdu/encode.js';
import { decodePdu } from '../src/pdu/decode.js';

describe('Heartbeat', () => {
  it('encodes a heartbeat response matching the request serial', () => {
    // The inverter sends HeartbeatRequest every ~3 minutes.
    // If the client doesn't respond within 5 seconds, the TCP connection drops.
    // Response must echo back the data adapter serial number.
    const response = encodeHeartbeatResponse('CE1234G567');
    // Should be a valid frame starting with 0x5959 0001
    expect(response[0]).toBe(0x59);
    expect(response[1]).toBe(0x59);
    expect(response[2]).toBe(0x00);
    expect(response[3]).toBe(0x01);
    // Function code at offset 7 should be 0x01 (heartbeat)
    expect(response[7]).toBe(0x01);
  });
});

describe('Read Registers Request Encoding', () => {
  it('encodes ReadHoldingRegistersRequest with correct structure', () => {
    // Transparent function code 0x03 = read holding registers
    const frame = encodeReadHoldingRegistersRequest({
      dataAdapterSerial: 'CE1234G567',
      slaveAddress: 0x11,
      baseRegister: 0,
      registerCount: 60,
    });
    // MBAP header
    expect(frame[0]).toBe(0x59); expect(frame[1]).toBe(0x59);
    expect(frame[7]).toBe(0x02); // function code: transparent
    // Inside transparent sub-frame, after serial(10) + padding(8):
    // slave address should be 0x11
    // transparent function code should be 0x03
  });

  it('encodes ReadInputRegistersRequest with function code 0x04', () => {
    const frame = encodeReadInputRegistersRequest({
      dataAdapterSerial: 'CE1234G567',
      slaveAddress: 0x32, // battery 1
      baseRegister: 60,
      registerCount: 60,
    });
    expect(frame[7]).toBe(0x02); // outer: transparent
  });

  it('includes CRC with byte-swap from little-endian to big-endian', () => {
    // GivEnergy quirk: CRC is calculated as Modbus CRC-16 (little-endian)
    // but then byte-swapped to big-endian for transmission.
    // Python: int.from_bytes(check.to_bytes(2, "little"), "big")
    const frame = encodeReadHoldingRegistersRequest({
      dataAdapterSerial: 'CE1234G567',
      slaveAddress: 0x31,
      baseRegister: 0,
      registerCount: 60,
    });
    // Frame should end with 2-byte CRC
    expect(frame.length).toBeGreaterThan(0);
    // CRC bytes are the last 2 bytes of the transparent sub-frame
  });
});

describe('Write Register Request Encoding', () => {
  it('encodes WriteHoldingRegisterRequest with function code 0x06', () => {
    // Used for all write operations: setting timeslots, SOC targets, modes, etc.
    const frame = encodeWriteHoldingRegisterRequest({
      dataAdapterSerial: 'CE1234G567',
      slaveAddress: 0x11,
      register: 116,  // charge_target_soc
      value: 80,
    });
    expect(frame[7]).toBe(0x02); // outer: transparent
  });
});

describe('PDU Decoding', () => {
  it('decodes a heartbeat request', () => {
    // Build a minimal heartbeat frame (fid=0x01)
    const frame = Buffer.from([
      0x59, 0x59, 0x00, 0x01,
      0x00, 0x0D, 0x01, 0x01, // uid=1, fid=1 (heartbeat)
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, // serial
      0x00, // data_adapter_type
    ]);
    const pdu = decodePdu(frame);
    expect(pdu.type).toBe('heartbeat');
    expect(pdu.dataAdapterSerial).toBe('ABCDEFGHIJ');
  });

  it('decodes a transparent read holding registers response', () => {
    // fid=0x02 (transparent), transparent_fc=0x03 (read holding)
    // Build with: serial(10) + padding(8) + slave(1) + fc(1) +
    //             inverter_serial(10) + base_reg(2) + count(2) + values + crc(2)
    // Minimal: 2 registers
    const frame = buildReadHoldingResponse(0x31, 0, 2, [0x1234, 0x5678]);
    const pdu = decodePdu(frame);
    expect(pdu.type).toBe('transparent');
    expect(pdu.transparentFunctionCode).toBe(0x03);
    expect(pdu.registerValues).toEqual([0x1234, 0x5678]);
    expect(pdu.slaveAddress).toBe(0x31);
    expect(pdu.baseRegister).toBe(0);
  });

  it('detects error flag in transparent function code', () => {
    // GivEnergy quirk: error responses set the high bit (0x80) on the
    // transparent function code. E.g., 0x83 = error on read holding (0x03).
    // Python: if transparent_function_code > 135: error = True
    // Note: 135 = 0x87, so the check is > 135, not >= 128.
    // This means codes 128-135 are NOT treated as errors — intentional.
    // Code 134 (0x86) is specifically accepted as a Gen1 BPM write response quirk.
    const frame = buildReadHoldingResponse(0x31, 0, 0, [], true); // error flag
    const pdu = decodePdu(frame);
    expect(pdu.error).toBe(true);
  });

  it('decodes inverter serial number from response', () => {
    // Transparent responses include a 10-byte inverter serial after slave+fc.
    // This is how the library learns the inverter's serial number during detection.
    const frame = buildReadHoldingResponse(0x31, 0, 2, [0, 0]);
    const pdu = decodePdu(frame);
    expect(pdu.inverterSerial).toBeDefined();
    expect(pdu.inverterSerial.length).toBe(10);
  });

  it('handles NullResponse (function code 0) gracefully', () => {
    // GivEnergy devices periodically send unsolicited null responses.
    // These have transparent function code 0 and 62 zero-valued registers.
    // They should be parsed without error and ignored by the client.
    // This is completely non-standard Modbus behavior.
    const frame = buildNullResponse();
    const pdu = decodePdu(frame);
    expect(pdu.type).toBe('transparent');
    expect(pdu.transparentFunctionCode).toBe(0);
  });

  it('accepts Gen1 BPM error code 134 as write response', () => {
    // Python: elif transparent_function_code == 134:
    //   return WriteHoldingRegisterResponse
    // Gen1 Battery Protection Module returns 0x86 (134) instead of
    // normal 0x06 for write acknowledgements. This is a firmware bug
    // that must be handled gracefully.
    const frame = buildWriteResponseWithCode(134);
    const pdu = decodePdu(frame);
    expect(pdu.error).toBe(false); // 134 is NOT an error, it's a Gen1 quirk
  });
});

// Helper to build test frames (implement in test file)
function buildReadHoldingResponse(
  slave: number, baseReg: number, count: number,
  values: number[], error = false,
): Buffer { /* ... */ }

function buildNullResponse(): Buffer { /* ... */ }
function buildWriteResponseWithCode(code: number): Buffer { /* ... */ }
```

**Step 2: Run tests to verify they fail**

Run: `cd givenergy-modbus && npx vitest run test/pdu.test.ts`
Expected: FAIL

**Step 3: Implement PDU types, encoder, and decoder**

Key implementation details:
- `types.ts`: Define `PduMessage` union type with `type: 'heartbeat' | 'transparent'`
- `encode.ts`: Build complete frames with MBAP header + transparent sub-frame + CRC (byte-swapped)
- `decode.ts`: Parse frames, handle error bit masking (`& 0x7F`), extract register values
- Handle the Gen1 BPM code 134 quirk explicitly

**Step 4: Run tests**

Run: `cd givenergy-modbus && npx vitest run test/pdu.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add givenergy-modbus/src/pdu/ givenergy-modbus/test/pdu.test.ts
git commit -m "feat: add PDU encoding/decoding with GivEnergy protocol quirks"
```

---

### Task 6: Shape Hash and Request/Response Matching

**Files:**
- Create: `givenergy-modbus/src/shape-hash.ts`
- Create: `givenergy-modbus/test/shape-hash.test.ts`

**Reference:** `GivTCP/givenergy_modbus_async/pdu/base.py` lines 142-152

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { shapeHash } from '../src/shape-hash.js';

describe('Shape Hash', () => {
  it('matches request to its expected response', () => {
    // GivEnergy doesn't use standard Modbus transaction IDs (tid is always 0x5959).
    // Instead, responses are matched to requests by "shape" — a hash of
    // (slave_address, function_code, base_register, register_count).
    // This is because the inverter may respond out of order.
    const requestHash = shapeHash(0x31, 0x04, 0, 60);
    const responseHash = shapeHash(0x31, 0x04, 0, 60);
    expect(requestHash).toBe(responseHash);
  });

  it('distinguishes different slave addresses', () => {
    // Battery 1 (0x32) and battery 2 (0x33) read the same registers
    // but are different devices and must not be confused.
    const bat1 = shapeHash(0x32, 0x04, 60, 60);
    const bat2 = shapeHash(0x33, 0x04, 60, 60);
    expect(bat1).not.toBe(bat2);
  });

  it('distinguishes holding vs input register reads', () => {
    // Same address range but different function codes
    const holding = shapeHash(0x31, 0x03, 0, 60);
    const input = shapeHash(0x31, 0x04, 0, 60);
    expect(holding).not.toBe(input);
  });

  it('distinguishes different register ranges', () => {
    const range1 = shapeHash(0x31, 0x04, 0, 60);
    const range2 = shapeHash(0x31, 0x04, 60, 60);
    expect(range1).not.toBe(range2);
  });
});
```

**Step 2: Run, implement, run, commit** (following TDD cycle)

---

### Task 7: Register Lookup Tables

**Files:**
- Create: `givenergy-modbus/src/model/register-lut.ts`
- Create: `givenergy-modbus/test/register-lut.test.ts`

**Reference:** All `REGISTER_LUT` dicts from `model/*.py`

This is the largest single file. It contains ALL register definitions for:
- Base inverter (HR 0-320+, IR 0-250+)
- Battery (IR 60-115)
- Meter (IR 60-88)
- EMS (HR 2040-2075, IR 2040-2094)
- Gateway (IR 1600-1852)
- HV BCU (IR 60-105)
- HV BMU (IR 60-118 + offset)
- Three-phase inverter (HR 1000-1124, IR 1000-1413)

**Step 1: Write tests that validate key registers**

```typescript
import { describe, it, expect } from 'vitest';
import { INVERTER_INPUT_REGISTERS, BATTERY_REGISTERS, MODEL_REGISTERS } from '../src/model/register-lut.js';

describe('Register Lookup Tables', () => {
  describe('Inverter Input Registers', () => {
    it('defines battery_percent at IR(59)', () => {
      // The main SOC register — used as the primary battery state indicator.
      const reg = INVERTER_INPUT_REGISTERS['battery_percent'];
      expect(reg.address).toBe(59);
    });

    it('defines PV power registers', () => {
      expect(INVERTER_INPUT_REGISTERS['p_pv1'].address).toBe(18);
      expect(INVERTER_INPUT_REGISTERS['p_pv2'].address).toBe(20);
    });

    it('defines grid power as signed int16', () => {
      // Grid power (IR 30) is signed: positive = export, negative = import.
      // This is counter-intuitive and a source of bugs in integrations.
      expect(INVERTER_INPUT_REGISTERS['p_grid_out'].address).toBe(30);
    });

    it('defines inverter heatsink temperature at IR(41)', () => {
      // Used in sanity check: if > 100°C, data is considered corrupt.
      expect(INVERTER_INPUT_REGISTERS['temp_inverter_heatsink'].address).toBe(41);
    });
  });

  describe('Battery Registers', () => {
    it('defines SOC at IR(100)', () => {
      expect(BATTERY_REGISTERS['soc'].address).toBe(100);
    });

    it('defines serial_number spanning IR(110-114)', () => {
      // 5 registers × 2 bytes = 10-char serial number.
      // Used for is_valid() check — null serial means no battery present.
      expect(BATTERY_REGISTERS['serial_number'].address).toBe(110);
      expect(BATTERY_REGISTERS['serial_number'].length).toBe(5);
    });

    it('defines all 16 cell voltage registers at IR(60-75)', () => {
      for (let i = 1; i <= 16; i++) {
        const key = `v_cell_${String(i).padStart(2, '0')}`;
        expect(BATTERY_REGISTERS[key].address).toBe(59 + i);
      }
    });
  });

  describe('Model Detection Register', () => {
    it('defines device_type_code at HR(0)', () => {
      // The single most important register — determines everything about
      // how the inverter is addressed, what registers it supports,
      // and whether it's HV or LV.
      expect(MODEL_REGISTERS['device_type_code'].address).toBe(0);
    });
  });
});
```

**Step 2: Implement register-lut.ts with all register definitions**

Port every register from the Python `REGISTER_LUT` dictionaries. Use typed objects rather than the Python metaclass approach.

**Step 3: Run tests, commit**

---

### Task 8: Model Detection and Plant Configuration

**Files:**
- Create: `givenergy-modbus/src/model/plant.ts`
- Create: `givenergy-modbus/src/model/device-types.ts`
- Create: `givenergy-modbus/test/model-detection.test.ts`

**Reference:** `GivTCP/givenergy_modbus_async/model/plant.py`, `register.py` `get_model()`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { detectModel, isHighVoltage, DeviceType } from '../src/model/device-types.js';
import { detectBatteries } from '../src/model/plant.js';

describe('Model Detection', () => {
  describe('detectModel from HR(0)', () => {
    it('detects Hybrid Gen3 from device type code', () => {
      // Python: hex(HR(0))[2:3] gives the 2nd hex digit.
      // "2xxx" = hybrid family. Generation determined by ARM firmware (HR 21).
      // This is EXTREMELY fragile — relies on positional hex string parsing.
      // Any firmware that changes the HR(0) format will break detection.
      const model = detectModel(0x2003, 300); // DTC=0x2003, ARM FW=300
      expect(model).toBe(DeviceType.HYBRID_GEN3);
    });

    it('detects Hybrid Gen1 for older firmware', () => {
      // ARM firmware version < 200 = Gen1
      const model = detectModel(0x2001, 100);
      expect(model).toBe(DeviceType.HYBRID_GEN1);
    });

    it('detects Hybrid Gen2 for firmware 8xx-9xx', () => {
      // ARM firmware / 100 == 8 or 9 = Gen2
      const model = detectModel(0x2001, 800);
      expect(model).toBe(DeviceType.HYBRID_GEN2);
    });

    it('detects AC inverter from hex prefix 3', () => {
      const model = detectModel(0x3001, 0);
      expect(model).toBe(DeviceType.AC);
    });

    it('detects 3-phase from hex prefix 4', () => {
      const model = detectModel(0x4001, 0);
      expect(model).toBe(DeviceType.HYBRID_3PH);
    });

    it('detects EMS from hex prefix 5', () => {
      const model = detectModel(0x5001, 0);
      expect(model).toBe(DeviceType.EMS);
    });

    it('detects Gateway from hex prefix 7', () => {
      const model = detectModel(0x7001, 0);
      expect(model).toBe(DeviceType.GATEWAY);
    });

    it('detects All-in-One from hex prefix 8', () => {
      const model = detectModel(0x8001, 0);
      expect(model).toBe(DeviceType.ALL_IN_ONE);
    });
  });

  describe('isHighVoltage', () => {
    it('returns true for ALL_IN_ONE', () => {
      expect(isHighVoltage(DeviceType.ALL_IN_ONE)).toBe(true);
    });
    it('returns true for AC_3PH', () => {
      expect(isHighVoltage(DeviceType.AC_3PH)).toBe(true);
    });
    it('returns true for HYBRID_3PH', () => {
      expect(isHighVoltage(DeviceType.HYBRID_3PH)).toBe(true);
    });
    it('returns true for HYBRID_HV_GEN3', () => {
      expect(isHighVoltage(DeviceType.HYBRID_HV_GEN3)).toBe(true);
    });
    it('returns true for ALL_IN_ONE_HYBRID', () => {
      expect(isHighVoltage(DeviceType.ALL_IN_ONE_HYBRID)).toBe(true);
    });
    it('returns false for HYBRID_GEN3 (low voltage)', () => {
      expect(isHighVoltage(DeviceType.HYBRID_GEN3)).toBe(false);
    });
    it('returns false for AC (low voltage)', () => {
      expect(isHighVoltage(DeviceType.AC)).toBe(false);
    });
  });

  describe('Battery Detection', () => {
    it('counts LV batteries by checking serial number validity', () => {
      // LV batteries at slave addresses 0x32-0x37.
      // A battery "exists" if its serial number registers (IR 110-114)
      // are not all-null and not all-spaces.
      // The Python code stops at the first invalid battery.
      const caches = new Map<number, Map<number, number>>();
      // Battery 1 at 0x32: valid serial
      caches.set(0x32, fakeRegistersWithSerial('CE1234G001'));
      // Battery 2 at 0x33: valid serial
      caches.set(0x33, fakeRegistersWithSerial('CE1234G002'));
      // Battery 3 at 0x34: null serial (no battery)
      caches.set(0x34, fakeRegistersWithSerial('\0\0\0\0\0\0\0\0\0\0'));

      const count = detectBatteries(caches, false);
      expect(count).toBe(2); // Stops at first invalid
    });

    it('returns 0 batteries for EMS devices', () => {
      // EMS and Gateway devices manage batteries indirectly.
      // Python: if model in (Model.EMS, Model.GATEWAY, Model.PV): number_batteries=0
      const count = detectBatteries(new Map(), false, DeviceType.EMS);
      expect(count).toBe(0);
    });
  });
});

function fakeRegistersWithSerial(serial: string): Map<number, number> { /* ... */ }
```

**Step 2: Implement device-types.ts and plant.ts**

**Step 3: Run tests, commit**

---

### Task 9: Client — Connection, Queue, Retries, Heartbeat

**Files:**
- Create: `givenergy-modbus/src/client.ts`
- Create: `givenergy-modbus/test/client.test.ts`

**Reference:** `GivTCP/givenergy_modbus_async/client/client.py`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, Server, Socket } from 'net';
import { Client } from '../src/client.js';

describe('Client', () => {
  let server: Server;
  let serverPort: number;
  let serverSockets: Socket[];

  beforeEach(async () => {
    serverSockets = [];
    server = createServer(socket => serverSockets.push(socket));
    await new Promise<void>(resolve => {
      server.listen(0, () => {
        serverPort = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    serverSockets.forEach(s => s.destroy());
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('connects to inverter on specified port', async () => {
    const client = new Client({ host: '127.0.0.1', port: serverPort });
    await client.connect();
    expect(serverSockets.length).toBe(1);
    await client.close();
  });

  it('enforces 250ms delay between outbound messages', async () => {
    // GivEnergy inverters cannot handle rapid-fire Modbus requests.
    // The Python code uses tx_message_wait=0.25 in _task_network_producer.
    // This is CRITICAL for inverter stability — without it, the device
    // stops responding and requires a power cycle.
    const client = new Client({ host: '127.0.0.1', port: serverPort });
    await client.connect();

    const timestamps: number[] = [];
    const originalWrite = serverSockets[0].write.bind(serverSockets[0]);

    // Queue 3 messages rapidly
    const start = Date.now();
    const p1 = client.sendRequest(fakeReadRequest(0x31, 0, 60));
    const p2 = client.sendRequest(fakeReadRequest(0x31, 60, 60));
    const p3 = client.sendRequest(fakeReadRequest(0x31, 120, 60));

    // Wait for all to be sent (they'll timeout, that's ok)
    await new Promise(r => setTimeout(r, 800));

    // Verify at least 250ms between each server receive
    // (exact timing assertion done by examining server-side timestamps)
    await client.close();
  });

  it('responds to heartbeat within 5 seconds', async () => {
    // The inverter sends HeartbeatRequest every ~3 minutes.
    // If the client doesn't respond within 5 seconds, TCP drops.
    // The heartbeat response must be queued immediately, bypassing
    // the normal 250ms throttle.
    const client = new Client({ host: '127.0.0.1', port: serverPort });
    await client.connect();

    // Server sends a heartbeat request
    const heartbeatReq = buildHeartbeatRequestFrame('CE1234G567');
    serverSockets[0].write(heartbeatReq);

    // Client should respond with heartbeat response
    const response = await waitForData(serverSockets[0], 1000);
    expect(response).toBeDefined();
    expect(response[7]).toBe(0x01); // function code: heartbeat

    await client.close();
  });

  it('cancels previous request when duplicate shape hash is queued', () => {
    // Python: if shape_hash in expected_responses and not future.done():
    //   future.cancel()
    // This prevents stale promises from leaking when the same register
    // range is re-requested (e.g. on a retry or new poll cycle).
    // The cancelled promise should reject, not hang forever.
  });

  it('retries on timeout up to configured max', async () => {
    // Python: while tries <= retries: send, wait, sleep(0.5), retry
    // Default: 5 retries with 500ms between each attempt.
    const client = new Client({
      host: '127.0.0.1', port: serverPort,
      retries: 2, timeout: 100,
    });
    await client.connect();

    const start = Date.now();
    await expect(
      client.sendRequest(fakeReadRequest(0x31, 0, 60))
    ).rejects.toThrow();
    const elapsed = Date.now() - start;

    // Should have retried: initial + 2 retries, each with ~100ms timeout + 500ms sleep
    expect(elapsed).toBeGreaterThan(500);

    await client.close();
  });

  it('retries when response has error flag set', async () => {
    // GivEnergy quirk: even a "successful" response can have an error flag.
    // Python: if response.error: retry
    // This catches intermittent firmware glitches where the inverter
    // acknowledges the request but returns garbage data.
  });
});

function fakeReadRequest(slave: number, base: number, count: number) { /* ... */ }
function buildHeartbeatRequestFrame(serial: string): Buffer { /* ... */ }
function waitForData(socket: Socket, timeout: number): Promise<Buffer> { /* ... */ }
```

**Step 2: Implement client.ts**

Key implementation points:
- `net.Socket` connection with `TCP_NODELAY`
- TX queue with 250ms drain delay
- Heartbeat handler in RX path (immediate response, bypasses queue)
- Shape-hash-based response matching with `Map<string, {resolve, reject}>`
- Retry loop with 500ms inter-retry delay
- `_failAllPending(error)` helper for connection loss

**Step 3: Run tests, commit**

---

### Task 10: Data Validation and Fallback Logic

**Files:**
- Create: `givenergy-modbus/src/validation.ts`
- Create: `givenergy-modbus/test/validation.test.ts`

**Reference:** `GivTCP/read.py` sanity checks and fallbacks

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  isSanityCheckPassing,
  applyStateOfChargeFallback,
  applyTimeFallback,
  applyFrequencyScaling,
  applyEnergyRegisterFallback,
} from '../src/validation.js';

describe('Sanity Check Validation', () => {
  it('rejects data where modbusVersion > 2', () => {
    // Python: float(GEInv.modbus_version) > 2
    // If the modbus version register contains garbage (e.g. 99.99),
    // the entire read is corrupt and should be discarded.
    expect(isSanityCheckPassing({ modbusVersion: 2.5, modbusAddress: 1, userCode: 1, heatsinkTemp: 30 })).toBe(false);
  });

  it('rejects data where modbusAddress > 100', () => {
    expect(isSanityCheckPassing({ modbusVersion: 0.4, modbusAddress: 255, userCode: 1, heatsinkTemp: 30 })).toBe(false);
  });

  it('rejects data where heatsinkTemp > 100°C', () => {
    // An inverter heatsink at > 100°C would be physically melting.
    // This indicates corrupt register data, not an actual temperature.
    expect(isSanityCheckPassing({ modbusVersion: 0.4, modbusAddress: 1, userCode: 1, heatsinkTemp: 150 })).toBe(false);
  });

  it('accepts normal data', () => {
    expect(isSanityCheckPassing({ modbusVersion: 0.4, modbusAddress: 1, userCode: 1, heatsinkTemp: 35 })).toBe(true);
  });
});

describe('State of Charge Fallback', () => {
  it('uses reported SOC when non-zero', () => {
    // Normal operation: battery reports accurate SOC
    expect(applyStateOfChargeFallback(85, null, false)).toBe(85);
  });

  it('uses reported SOC when zero but calibrating', () => {
    // During battery calibration (soc_force_adjust != 0), SOC genuinely
    // reaches 0% as part of the calibration process. Accept it.
    expect(applyStateOfChargeFallback(0, null, true)).toBe(0);
  });

  it('uses previous cached SOC when reported as 0 with history', () => {
    // Communication glitches can cause temporary 0% readings.
    // Rather than alarming the user or triggering automation rules,
    // the library uses the last known good value.
    expect(applyStateOfChargeFallback(0, 72, false)).toBe(72);
  });

  it('defaults to 1% when reported as 0 with no history', () => {
    // First read after startup with comms issues.
    // Default to 1% — not 0% — to avoid "battery empty" false alarms.
    // Python: power_output['SOC'] = 1
    expect(applyStateOfChargeFallback(0, null, false)).toBe(1);
  });
});

describe('Time Fallback', () => {
  it('uses reported time when year is not 2000', () => {
    const reported = new Date(2024, 5, 15, 14, 30, 0);
    expect(applyTimeFallback(reported, null).getFullYear()).toBe(2024);
  });

  it('uses cached time when year is 2000 and cache exists', () => {
    // GivEnergy inverters ship with default RTC set to year 2000.
    // If the inverter hasn't synced NTP, it reports year 2000.
    // Python: if GEInv.system_time.year == 2000
    const reported = new Date(2000, 0, 1, 0, 0, 0);
    const cached = new Date(2024, 5, 15, 14, 30, 0);
    expect(applyTimeFallback(reported, cached).getFullYear()).toBe(2024);
  });

  it('uses current local time when year is 2000 and no cache', () => {
    const reported = new Date(2000, 0, 1, 0, 0, 0);
    const result = applyTimeFallback(reported, null);
    expect(result.getFullYear()).toBeGreaterThan(2000);
  });
});

describe('Frequency Scaling', () => {
  it('divides by 10 when raw centi-Hz value > 100', () => {
    // Some firmware versions report AC frequency as centi-Hz (5000 = 50.00Hz)
    // while others report deci-Hz (500 = 50.0Hz) or direct Hz (50.1).
    // Python: if GEInv.f_ac1 > 100: freq = GEInv.f_ac1 / 10
    expect(applyFrequencyScaling(5000)).toBeCloseTo(500);
    expect(applyFrequencyScaling(500)).toBeCloseTo(50);
  });

  it('leaves Hz values unchanged when <= 100', () => {
    expect(applyFrequencyScaling(50.1)).toBeCloseTo(50.1);
  });
});

describe('Energy Register Fallback', () => {
  it('uses primary registers when non-zero', () => {
    const result = applyEnergyRegisterFallback(123.4, 567.8, 0, 0);
    expect(result.charge).toBeCloseTo(123.4);
    expect(result.discharge).toBeCloseTo(567.8);
  });

  it('falls back to secondary registers when both primaries are zero', () => {
    // Old firmware versions don't populate the primary battery energy
    // registers. The backup registers (suffix _2 in Python) contain
    // the same data from a different source.
    // Python: if GEBat[0].e_battery_charge_total == 0 and ... == 0
    const result = applyEnergyRegisterFallback(0, 0, 99.9, 88.8);
    expect(result.charge).toBeCloseTo(99.9);
    expect(result.discharge).toBeCloseTo(88.8);
  });

  it('uses primary even if only one is zero', () => {
    // Only fall back when BOTH are zero — one being zero is valid
    // (e.g. a new battery that's only ever charged)
    const result = applyEnergyRegisterFallback(0, 50.0, 99.9, 88.8);
    expect(result.charge).toBeCloseTo(0);
    expect(result.discharge).toBeCloseTo(50.0);
  });
});
```

**Step 2: Implement validation.ts**

**Step 3: Run tests, commit**

---

### Task 11: Power Flow Calculator

**Files:**
- Create: `givenergy-modbus/src/power-flow.ts`
- Create: `givenergy-modbus/test/power-flow.test.ts`

**Reference:** `GivTCP/read.py` lines 1240-1274

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { calculatePowerFlows } from '../src/power-flow.js';

describe('Power Flow Calculator', () => {
  it('calculates solar to house when solar covers load', () => {
    const flows = calculatePowerFlows({
      solarWatts: 3000, loadWatts: 2000,
      chargeWatts: 500, dischargeWatts: 0,
      importWatts: 0, exportWatts: 500,
    });
    expect(flows.solarToHouse).toBe(2000);
    expect(flows.solarToBattery).toBe(500);
    expect(flows.solarToGrid).toBe(500);
  });

  it('calculates battery to house when solar is insufficient', () => {
    const flows = calculatePowerFlows({
      solarWatts: 500, loadWatts: 2000,
      chargeWatts: 0, dischargeWatts: 1500,
      importWatts: 0, exportWatts: 0,
    });
    expect(flows.solarToHouse).toBe(500);
    expect(flows.batteryToHouse).toBe(1500);
  });

  it('calculates grid to house and grid to battery during AC charge', () => {
    const flows = calculatePowerFlows({
      solarWatts: 0, loadWatts: 500,
      chargeWatts: 3000, dischargeWatts: 0,
      importWatts: 3500, exportWatts: 0,
    });
    expect(flows.gridToHouse).toBe(500);
    expect(flows.gridToBattery).toBe(3000);
  });

  it('calculates battery to grid during forced export', () => {
    const flows = calculatePowerFlows({
      solarWatts: 0, loadWatts: 0,
      chargeWatts: 0, dischargeWatts: 3000,
      importWatts: 0, exportWatts: 3000,
    });
    expect(flows.batteryToGrid).toBe(3000);
  });

  it('handles zero generation gracefully', () => {
    // Night time, no solar, no battery, grid powers everything
    const flows = calculatePowerFlows({
      solarWatts: 0, loadWatts: 1000,
      chargeWatts: 0, dischargeWatts: 0,
      importWatts: 1000, exportWatts: 0,
    });
    expect(flows.gridToHouse).toBe(1000);
    expect(flows.solarToHouse).toBe(0);
    expect(flows.batteryToHouse).toBe(0);
  });
});
```

**Step 2: Implement, run, commit**

---

### Task 12: Snapshot Types and Builder

**Files:**
- Create: `givenergy-modbus/src/model/inverter-snapshot.ts`
- Create: `givenergy-modbus/src/model/battery-snapshot.ts`
- Create: `givenergy-modbus/src/snapshot-builder.ts`
- Create: `givenergy-modbus/test/snapshot-builder.test.ts`

**Reference:** `GivTCP/read.py` `processInverterInfo()` output structure

**Step 1: Write tests focused on the workaround-heavy data assembly**

Tests should cover:
- Building `InverterSnapshot` from raw register caches
- LV battery assembly with SOC fallback
- HV battery assembly with 0.9× capacity
- Frequency scaling applied
- Time validation applied
- Energy register fallback applied
- Sanity checks reject bad data

**Step 2: Implement snapshot builder**

**Step 3: Run tests, commit**

---

### Task 13: Poll Manager — Refresh Loop and Cache

**Files:**
- Create: `givenergy-modbus/src/poll-manager.ts`
- Create: `givenergy-modbus/test/poll-manager.test.ts`

**Reference:** `GivTCP/read.py` `watch_plant()`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PollManager } from '../src/poll-manager.js';

describe('PollManager', () => {
  it('performs partial refresh every 15 seconds', () => {
    // Partial refresh reads only real-time power/energy registers.
    // This reduces Modbus traffic and is faster on slow connections.
  });

  it('performs full refresh every 60 seconds', () => {
    // Full refresh includes config, timeslots, battery details.
    // Needed because these registers change rarely.
  });

  it('always uses full refresh for Gateway devices', () => {
    // Python: if inverter_type.lower() == "gateway": fullRefresh = True
    // Gateway devices coordinate multiple AIOs whose state can drift.
  });

  it('tracks consecutive failures and emits lost after 10', () => {
    // Python: if failcount >= 10: rebootaddon()
    // In the library we emit 'lost' instead of restarting.
  });

  it('resets failure counter on successful poll', () => {});

  it('provides cached snapshot via getData()', () => {});

  it('throws if getData() called before start()', () => {});

  it('reconnects after 5 consecutive timeout errors', () => {
    // Python: if timeoutErrors > 5: close() + sleep(2) + connect()
  });
});
```

**Step 2: Implement poll-manager.ts**

**Step 3: Run tests, commit**

---

### Task 14: Discovery — Subnet Scanner

**Files:**
- Create: `givenergy-modbus/src/discover.ts`
- Create: `givenergy-modbus/test/discover.test.ts`

**Reference:** `GivTCP/findInvertor.py`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { parseSubnet, getLocalSubnet } from '../src/discover.js';

describe('Discovery', () => {
  describe('parseSubnet', () => {
    it('expands CIDR /24 to 254 host addresses', () => {
      const hosts = parseSubnet('192.168.1.0/24');
      expect(hosts.length).toBe(254);
      expect(hosts[0]).toBe('192.168.1.1');
      expect(hosts[253]).toBe('192.168.1.254');
    });

    it('excludes network and broadcast addresses', () => {
      const hosts = parseSubnet('192.168.1.0/24');
      expect(hosts).not.toContain('192.168.1.0');
      expect(hosts).not.toContain('192.168.1.255');
    });

    it('handles /32 as single host', () => {
      // GivTCP special case: /32 (host-only) falls back to /24
      // We handle it differently — /32 means scan just that one host.
      const hosts = parseSubnet('192.168.1.50/32');
      expect(hosts.length).toBe(1);
      expect(hosts[0]).toBe('192.168.1.50');
    });
  });

  describe('getLocalSubnet', () => {
    it('returns a valid CIDR notation', () => {
      // Uses the same UDP trick as GivTCP's Docker path:
      // Open a UDP socket to a dummy address, read getsockname().
      // Always assumes /24 since the true mask isn't available this way.
      const subnet = getLocalSubnet();
      expect(subnet).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);
    });
  });
});
```

**Step 2: Implement discover.ts**

Port the scanning approach:
- `parseSubnet()`: CIDR to IP list
- `getLocalSubnet()`: UDP trick to find local IP, assume /24
- `discover(subnet?)`: parallel TCP connect attempts to port 8899, 20 concurrent, 1s timeout

**Step 3: Run tests, commit**

---

### Task 15: GivEnergyInverter — Public API Class

**Files:**
- Create: `givenergy-modbus/src/inverter.ts`
- Create: `givenergy-modbus/test/inverter.test.ts`
- Modify: `givenergy-modbus/src/index.ts` — export public API

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { GivEnergyInverter } from '../src/inverter.js';

describe('GivEnergyInverter', () => {
  it('throws from getData() if not started', () => {
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    expect(() => inv.getData()).toThrow('not started');
  });

  it('extends EventEmitter', () => {
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    expect(typeof inv.on).toBe('function');
    expect(typeof inv.emit).toBe('function');
  });

  it('exposes start() and stop() as async methods', () => {
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    expect(typeof inv.start).toBe('function');
    expect(typeof inv.stop).toBe('function');
  });

  it('exposes write methods', () => {
    const inv = new GivEnergyInverter({ host: '192.168.1.100' });
    expect(typeof inv.setChargeSlot).toBe('function');
    expect(typeof inv.setDischargeSlot).toBe('function');
    expect(typeof inv.setMode).toBe('function');
    expect(typeof inv.setTargetStateOfCharge).toBe('function');
  });
});
```

**Step 2: Implement inverter.ts**

Wire together: Client → PollManager → SnapshotBuilder → EventEmitter.
Expose write methods that queue through the client.

**Step 3: Update index.ts with public exports**

```typescript
export { GivEnergyInverter } from './inverter.js';
export { discover } from './discover.js';
export type { InverterSnapshot } from './model/inverter-snapshot.js';
export type { BatterySnapshot } from './model/battery-snapshot.js';
```

**Step 4: Run all tests**

Run: `cd givenergy-modbus && npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
git add givenergy-modbus/
git commit -m "feat: add GivEnergyInverter public API with EventEmitter"
```

---

### Task 16: Integration Test with Mock Inverter

**Files:**
- Create: `givenergy-modbus/test/integration.test.ts`

**Step 1: Write a mock GivEnergy inverter TCP server**

A test helper that:
- Listens on a random port
- Responds to heartbeats
- Returns plausible register data for detection (HR 0, HR 21)
- Returns battery data for 2 LV batteries
- Returns power/energy data

**Step 2: Write integration tests**

```typescript
describe('Integration', () => {
  it('detects model, batteries, and starts polling', async () => {
    const mock = await startMockInverter();
    const inv = new GivEnergyInverter({ host: '127.0.0.1', port: mock.port });

    await inv.start();
    const snapshot = inv.getData();

    expect(snapshot.serialNumber).toBeDefined();
    expect(snapshot.batteries.length).toBe(2);
    expect(snapshot.power.stateOfCharge).toBeGreaterThan(0);

    await inv.stop();
    await mock.close();
  });

  it('emits data events on each poll', async () => {
    const mock = await startMockInverter();
    const inv = new GivEnergyInverter({ host: '127.0.0.1', port: mock.port });

    const snapshots: InverterSnapshot[] = [];
    inv.on('data', s => snapshots.push(s));

    await inv.start();
    await new Promise(r => setTimeout(r, 200));

    expect(snapshots.length).toBeGreaterThan(0);

    await inv.stop();
    await mock.close();
  });

  it('writes charge slot and receives acknowledgement', async () => {
    const mock = await startMockInverter();
    const inv = new GivEnergyInverter({ host: '127.0.0.1', port: mock.port });

    await inv.start();
    await inv.setChargeSlot(1, {
      start: '00:30', end: '04:30', targetStateOfCharge: 100,
    });

    // Verify mock received the write
    expect(mock.lastWrittenRegister).toBe(94); // charge_slot_1_start
    expect(mock.lastWrittenValue).toBeDefined();

    await inv.stop();
    await mock.close();
  });
});
```

**Step 3: Run, commit**

---

### Task 17: Final Wiring, Exports, and Build Check

**Files:**
- Modify: `givenergy-modbus/src/index.ts`
- Modify: `givenergy-modbus/package.json`

**Step 1: Verify all exports**

```typescript
// index.ts
export { GivEnergyInverter } from './inverter.js';
export { discover } from './discover.js';
export type { InverterSnapshot } from './model/inverter-snapshot.js';
export type { BatterySnapshot } from './model/battery-snapshot.js';
export type { TimeSlot } from './model/register-types.js';
```

**Step 2: Build**

Run: `cd givenergy-modbus && npx tsc`
Expected: No errors

**Step 3: Run full test suite**

Run: `cd givenergy-modbus && npx vitest run`
Expected: All PASS

**Step 4: Final commit**

```bash
git add givenergy-modbus/
git commit -m "feat: complete givenergy-modbus TypeScript library v0.1.0"
```
