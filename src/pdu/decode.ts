import type { PduMessage } from './types.js';

/**
 * Decode a GivEnergy PDU frame into a structured message.
 *
 * Frame layout (all big-endian):
 *   Bytes 0-1:   TID (0x5959)
 *   Bytes 2-3:   protocol ID (0x0001)
 *   Bytes 4-5:   length
 *   Byte  6:     uid
 *   Byte  7:     fid (0x01=heartbeat, 0x02=transparent)
 *   Bytes 8-17:  data_adapter_serial (10 bytes, latin1)
 *
 * Heartbeat (fid=0x01):
 *   Byte 18: data_adapter_type
 *
 * Transparent response (fid=0x02):
 *   Bytes 18-25: padding (8 bytes)
 *   Byte  26:    slave_address
 *   Byte  27:    transparent_function_code
 *   Bytes 28-37: inverter_serial (10 bytes, latin1)
 *   Bytes 38-39: base_register (uint16)
 *   Bytes 40-41: register_count (uint16)
 *   Bytes 42+:   register_values (register_count * uint16)
 *   Last 2:      CRC
 *
 * Error detection:
 *   transparent_function_code > 135 → error = true
 *   EXCEPTION: fc 134 (0x86) is NOT an error (Gen1 BPM write response quirk)
 *   Since 134 <= 135 the rule "fc > 135" correctly handles both cases.
 */
export function decodePdu(frame: Buffer): PduMessage {
  const fid = frame[7];

  if (fid === 0x01) {
    // Heartbeat frame
    const dataAdapterSerial = frame.subarray(8, 18).toString('latin1');
    const dataAdapterType = frame[18];
    return {
      type: 'heartbeat',
      dataAdapterSerial,
      dataAdapterType,
    };
  }

  // Transparent frame (fid === 0x02)
  // 8-byte padding at offsets 18-25 (skipped)
  const slaveAddress = frame[26];
  const transparentFunctionCode = frame[27];
  const inverterSerial = frame.subarray(28, 38).toString('latin1');
  const baseRegister = frame.readUInt16BE(38);
  // For write responses, the two bytes at 40-41 represent the written value, not a count.
  // We guard against reading beyond the buffer by capping register count.
  const rawCount = frame.readUInt16BE(40);
  // Available bytes for register values: frame length minus offset 42, minus 2 for trailing CRC
  const availableBytes = Math.max(0, frame.length - 42 - 2);
  const registerCount = Math.min(rawCount, Math.floor(availableBytes / 2));

  const registerValues: number[] = [];
  for (let i = 0; i < registerCount; i++) {
    registerValues.push(frame.readUInt16BE(42 + i * 2));
  }

  // GivEnergy error detection: high bit set (fc >= 128) indicates an error.
  // EXCEPTION: fc 134 (0x86) is a Gen1 BPM write quirk and must NOT be flagged as an error.
  const error = transparentFunctionCode >= 128 && transparentFunctionCode !== 134;

  return {
    type: 'transparent',
    transparentFunctionCode,
    slaveAddress,
    inverterSerial,
    baseRegister,
    registerCount,
    registerValues,
    error,
  };
}
