import { describe, it, expect } from 'vitest';
import { Framer, HEADER_START_MARKER } from '../src/framer.js';

describe('Framer', () => {
  it('exports the correct start marker', () => {
    // GivEnergy frames always start with 0x59590001 ("YY" + protocol 0x0001).
    // tid is a FIXED constant — NOT a standard Modbus transaction counter.
    expect(HEADER_START_MARKER).toEqual(Buffer.from([0x59, 0x59, 0x00, 0x01]));
  });

  it('extracts a complete frame from buffer', () => {
    const framer = new Framer();
    // Heartbeat frame: tid(2) + pid(2) + len(2) + uid(1) + fid(1) + serial(10) + type(1) = 19 bytes
    // len = 0x0D = 13 (uid=1 + fid=1 + serial=10 + type=1 = 13)
    const frame = buildHeartbeatFrame();
    const results = framer.decode(frame);
    expect(results.filter(r => r.type === 'frame').length).toBe(1);
  });

  it('handles partial frames by buffering and returning nothing', () => {
    // TCP fragmentation: first chunk arrives without complete frame
    const framer = new Framer();
    const partial = Buffer.from([0x59, 0x59, 0x00, 0x01, 0x00, 0x0D, 0x01]);
    const results = framer.decode(partial);
    expect(results.filter(r => r.type === 'frame').length).toBe(0);
  });

  it('completes a partial frame when remaining bytes arrive', () => {
    const framer = new Framer();
    framer.decode(Buffer.from([0x59, 0x59, 0x00, 0x01, 0x00, 0x0D, 0x01]));
    const rest = buildHeartbeatFrame().subarray(7); // rest of the frame
    const results = framer.decode(rest);
    expect(results.filter(r => r.type === 'frame').length).toBe(1);
  });

  it('discards leading garbage bytes before a valid frame', () => {
    // GivEnergy inverters sometimes emit corrupt bytes before valid frames.
    // The framer scans forward to find the next 0x59590001 marker.
    const framer = new Framer();
    const garbage = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
    const results = framer.decode(Buffer.concat([garbage, buildHeartbeatFrame()]));
    expect(results.filter(r => r.type === 'frame').length).toBe(1);
  });

  it('extracts multiple frames from a single buffer', () => {
    // TCP may deliver multiple frames in a single read
    const framer = new Framer();
    const frame = buildHeartbeatFrame();
    const results = framer.decode(Buffer.concat([frame, frame]));
    expect(results.filter(r => r.type === 'frame').length).toBe(2);
  });

  it('rejects frames with uid not in {0, 1}', () => {
    const framer = new Framer();
    const bad = buildHeartbeatFrame();
    bad[6] = 0x05; // corrupt uid
    const results = framer.decode(bad);
    expect(results.filter(r => r.type === 'frame').length).toBe(0);
  });

  it('rejects frames with fid not in {1, 2}', () => {
    const framer = new Framer();
    const bad = buildHeartbeatFrame();
    bad[7] = 0x99; // corrupt fid
    const results = framer.decode(bad);
    expect(results.filter(r => r.type === 'frame').length).toBe(0);
  });

  it('rejects frames with hdr_len > 300', () => {
    // Prevents memory exhaustion from corrupt length fields
    const framer = new Framer();
    const bad = buildHeartbeatFrame();
    bad[4] = 0x01; bad[5] = 0x2D; // len = 301
    const results = framer.decode(bad);
    expect(results.filter(r => r.type === 'frame').length).toBe(0);
  });
});

function buildHeartbeatFrame(): Buffer {
  // tid(2) + pid(2) + len(2) + uid(1) + fid(1) + serial(10) + type(1)
  // len = 13 (uid=1 + fid=1 + serial=10 + type=1)
  return Buffer.from([
    0x59, 0x59, 0x00, 0x01, // tid + pid
    0x00, 0x0D,             // length: 13
    0x01,                   // uid
    0x01,                   // fid: heartbeat
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, // serial
    0x00,                   // data_adapter_type
  ]);
}
