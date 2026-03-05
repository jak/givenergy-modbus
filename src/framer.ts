/**
 * Sliding-window frame parser for the GivEnergy proprietary Modbus-over-TCP protocol.
 *
 * GivEnergy inverters communicate over TCP port 8899 using a protocol that is similar
 * to standard Modbus TCP but with several quirks:
 *
 * - The transaction ID (tid) is always the fixed constant 0x5959 ("YY" in ASCII),
 *   never a per-request counter as in standard Modbus.
 * - The protocol ID (pid) is always 0x0001.
 * - The length field adds 1 extra byte compared to standard Modbus TCP.
 * - The unit ID (uid) is always 0x00 or 0x01.
 * - The function ID (fid) is 0x01 (heartbeat) or 0x02 (transparent).
 *
 * Frame structure:
 *   Bytes 0-1:  0x5959  (fixed tid)
 *   Bytes 2-3:  0x0001  (pid)
 *   Bytes 4-5:  length  (bytes following; includes uid + fid + data; +1 vs standard Modbus)
 *   Byte  6:    uid     (0x00 or 0x01)
 *   Byte  7:    fid     (0x01 heartbeat, 0x02 transparent)
 *   Bytes 8+:   data    (length-2 bytes)
 *
 * Total frame length = 6 + length_field_value.
 * Minimum valid frame = 18 bytes (heartbeat).
 *
 * Reference: GivTCP/givenergy_modbus_async/framer.py
 */

/** Fixed 4-byte start marker present at the beginning of every GivEnergy frame. */
export const HEADER_START_MARKER: Buffer = Buffer.from([0x59, 0x59, 0x00, 0x01]);

/** A successfully extracted raw frame. */
export type FrameResult = { type: 'frame'; data: Buffer };

/** A framing error encountered while parsing the byte stream. */
export type ErrorResult = { type: 'error'; reason: string };

/** Union of all results that decode() can yield. */
export type DecodeResult = FrameResult | ErrorResult;

const MIN_FRAME_LENGTH = 18;
const MAX_HDR_LEN = 300;
const VALID_UIDS = new Set([0, 1]);
const VALID_FIDS = new Set([1, 2]);

/**
 * Stateful sliding-window framer for the GivEnergy protocol.
 *
 * Feed raw TCP bytes into decode() as they arrive. The framer appends data to
 * an internal buffer and extracts complete frames, handling:
 *   - TCP fragmentation (partial frames buffered until remaining bytes arrive)
 *   - Leading garbage bytes (scans forward for the 0x59590001 marker)
 *   - Multiple frames in a single read
 *   - Corrupt/invalid header fields (discarded with an error result)
 */
export class Framer {
  private _buffer: Buffer = Buffer.alloc(0);

  /**
   * Append raw bytes to the internal buffer and extract all complete frames.
   *
   * Returns an array of results. Each entry is either a successfully extracted
   * frame ({ type: 'frame', data }) or a framing error ({ type: 'error', reason }).
   * When the buffer does not yet contain a full frame, an empty array is returned
   * and the partial data is retained for the next call.
   */
  decode(data: Buffer): DecodeResult[] {
    this._buffer = Buffer.concat([this._buffer, data]);
    const results: DecodeResult[] = [];

    while (this._buffer.length >= MIN_FRAME_LENGTH) {
      // Find the start-of-frame marker in the buffer
      const frameStartOffset = this._buffer.indexOf(HEADER_START_MARKER);

      if (frameStartOffset < 0) {
        // No marker found at all — keep the last 3 bytes in case the marker
        // is split across two reads, then await more data
        const keepBytes = Math.min(3, this._buffer.length);
        this._buffer = this._buffer.subarray(this._buffer.length - keepBytes);
        break;
      }

      if (frameStartOffset > 0) {
        // Marker not at the head of the buffer — discard leading garbage
        results.push({
          type: 'error',
          reason: `Discarding ${frameStartOffset} leading garbage byte(s): 0x${this._buffer.subarray(0, frameStartOffset).toString('hex')}`,
        });
        this._buffer = this._buffer.subarray(frameStartOffset);
        continue;
      }

      // Marker is at position 0. Check whether the *next* marker appears
      // implausibly soon (< 18 bytes away), which would mean the current
      // candidate frame is corrupt.
      const nextFrameStartOffset = this._buffer.indexOf(HEADER_START_MARKER, 1);
      if (nextFrameStartOffset > 0 && nextFrameStartOffset < MIN_FRAME_LENGTH) {
        results.push({
          type: 'error',
          reason: `Next frame marker found only ${nextFrameStartOffset} byte(s) away — current frame is corrupt, skipping forward`,
        });
        this._buffer = this._buffer.subarray(nextFrameStartOffset);
        continue;
      }

      // Validate MBAP header fields
      const hdrLen = this._buffer.readUInt16BE(4);
      const uid = this._buffer[6];
      const fid = this._buffer[7];

      if (hdrLen > MAX_HDR_LEN || !VALID_UIDS.has(uid) || !VALID_FIDS.has(fid)) {
        results.push({
          type: 'error',
          reason: `Invalid header fields (hdr_len=0x${hdrLen.toString(16)}, uid=0x${uid.toString(16)}, fid=0x${fid.toString(16)}) — discarding 4 bytes and resuming search`,
        });
        // Discard just past the marker so we can search for the next one
        this._buffer = this._buffer.subarray(4);
        continue;
      }

      // Calculate full frame length and wait if the buffer is not yet complete
      const frameLen = 6 + hdrLen;
      if (this._buffer.length < frameLen) {
        // Partial frame — await more data
        break;
      }

      // Extract the complete frame and advance the buffer
      const frame = Buffer.from(this._buffer.subarray(0, frameLen));
      this._buffer = this._buffer.subarray(frameLen);
      results.push({ type: 'frame', data: frame });
    }

    return results;
  }
}
