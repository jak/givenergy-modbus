/**
 * Loads a wire capture from test/fixtures/captures/ into per-slave register caches.
 *
 * Captures come in two line formats:
 *   "<ISO timestamp> rx <hex>"   (givenergy-cli capture)
 *   "rx: <hex>"                  (Home Assistant integration capture, with a "#" header)
 * Only rx frames are used; tx frames are requests and carry no register values.
 * Comment lines ("# ... reconnected after 0s gap") are ignored.
 *
 * Quirks:
 * - A line can hold more than one frame: the capture tool sometimes glued a heartbeat onto
 *   the end of a data frame. Lines are split using each frame's own length header.
 * - CRCs are not checked; the upstream capture tool re-encoded frames with fresh CRCs when
 *   it redacted serials.
 * - Later frames overwrite earlier ones, so each register holds its last captured value.
 */
import { readFileSync } from 'node:fs';
import { decodePdu } from '../../src/pdu/decode.js';

export interface SlaveRegisters {
  holding: Map<number, number>;
  input: Map<number, number>;
  meterProduct: Map<number, number>;
}

/** Why rx frames were not loaded into a register cache. */
export interface SkippedFrames {
  /** Truncated (shorter than its length header), or decodePdu threw. */
  malformed: number;
  heartbeat: number;
  /** Error replies (function code with the high bit set, except the 0x86 quirk). */
  error: number;
  /** Transparent frames with no register values. */
  empty: number;
  /** Function codes other than 3 (holding), 4 (input) and 22 (meter product), e.g. write echoes. */
  otherFunctionCode: number;
}

export interface CapturedPlant {
  slaves: Map<number, SlaveRegisters>;
  /** Returns the slave's registers; throws if the capture holds no data for that address. */
  slave(address: number): SlaveRegisters;
  /** Number of frames found on rx lines. */
  rxFrames: number;
  skipped: SkippedFrames;
}

const RX_LINE = /\brx:?\s+([0-9a-f]+)\s*$/i;
/** TID (2) + protocol (2) + length (2); the length field counts the bytes after these. */
const HEADER_BYTES = 6;

type RegisterTable = keyof SlaveRegisters;
const TABLE_BY_FUNCTION_CODE: Record<number, RegisterTable | undefined> = {
  3: 'holding',
  4: 'input',
  22: 'meterProduct',
};

/** Splits one rx line's bytes into frames; a trailing partial frame is returned as-is. */
function splitFrames(bytes: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const length = remaining >= HEADER_BYTES ? bytes.readUInt16BE(offset + 4) + HEADER_BYTES : remaining;
    frames.push(bytes.subarray(offset, offset + Math.min(length, remaining)));
    offset += length;
  }
  return frames;
}

function isComplete(frame: Buffer): boolean {
  return frame.length >= HEADER_BYTES && frame.readUInt16BE(4) + HEADER_BYTES === frame.length;
}

export function parseCapture(text: string, name = 'inline capture'): CapturedPlant {
  const slaves = new Map<number, SlaveRegisters>();
  const skipped: SkippedFrames = { malformed: 0, heartbeat: 0, error: 0, empty: 0, otherFunctionCode: 0 };
  let rxFrames = 0;

  const slaveFor = (address: number): SlaveRegisters => {
    let registers = slaves.get(address);
    if (!registers) {
      registers = { holding: new Map(), input: new Map(), meterProduct: new Map() };
      slaves.set(address, registers);
    }
    return registers;
  };

  for (const line of text.split('\n')) {
    const match = RX_LINE.exec(line);
    if (!match) continue;
    for (const frame of splitFrames(Buffer.from(match[1], 'hex'))) {
      rxFrames++;
      if (!isComplete(frame)) { skipped.malformed++; continue; }
      let pdu;
      try {
        pdu = decodePdu(frame);
      } catch {
        skipped.malformed++;
        continue;
      }
      if (pdu.type !== 'transparent') { skipped.heartbeat++; continue; }
      if (pdu.error) { skipped.error++; continue; }
      if (pdu.registerValues.length === 0) { skipped.empty++; continue; }
      const table = TABLE_BY_FUNCTION_CODE[pdu.transparentFunctionCode];
      if (!table) { skipped.otherFunctionCode++; continue; }

      const target = slaveFor(pdu.slaveAddress)[table];
      const { baseRegister } = pdu;
      pdu.registerValues.forEach((value, i) => target.set(baseRegister + i, value));
    }
  }

  return {
    slaves,
    slave(address: number): SlaveRegisters {
      const registers = slaves.get(address);
      if (!registers) {
        const known = [...slaves.keys()].map((a) => `0x${a.toString(16)}`).join(', ');
        throw new Error(`${name} has no data for slave 0x${address.toString(16)} (has: ${known || 'none'})`);
      }
      return registers;
    },
    rxFrames,
    skipped,
  };
}

/** Loads test/fixtures/captures/<name>. */
export function loadCapture(name: string): CapturedPlant {
  const text = readFileSync(new URL(`../fixtures/captures/${name}`, import.meta.url), 'utf8');
  return parseCapture(text, name);
}
