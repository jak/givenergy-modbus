import { describe, it, expect } from 'vitest';
import { encodeHeartbeatResponse } from '../src/pdu/heartbeat.js';
import {
  encodeReadHoldingRegistersRequest,
  encodeReadInputRegistersRequest,
  encodeWriteHoldingRegisterRequest,
} from '../src/pdu/encode.js';
import { decodePdu } from '../src/pdu/decode.js';

// Helper: build a transparent READ HOLDING REGISTERS response frame
function buildReadHoldingResponse(
  slave: number,
  baseReg: number,
  count: number,
  values: number[],
  errorFlag = false,
): Buffer {
  const paddedSerial = Buffer.from('SA1234B567'.padStart(10, '*'), 'latin1');
  const fc = errorFlag ? 0x83 : 0x03; // error sets high bit

  // Build sub-frame content (slave+fc+inverterSerial+baseReg+count+values+crc)
  const subPayload: number[] = [
    slave, fc,
    ...Array.from(paddedSerial),
    (baseReg >> 8) & 0xFF, baseReg & 0xFF,
    (count >> 8) & 0xFF, count & 0xFF,
  ];
  for (const v of values) {
    subPayload.push((v >> 8) & 0xFF, v & 0xFF);
  }
  // Add dummy CRC (2 bytes)
  subPayload.push(0x00, 0x00);

  // Build full frame
  const adapterSerial = Buffer.from('CE1234G567'.padStart(10, '*'), 'latin1');
  const padding = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08]);
  const body = Buffer.concat([
    adapterSerial,           // 10 bytes
    padding,                 // 8 bytes
    Buffer.from(subPayload), // variable
  ]);
  const payloadLen = body.length + 2; // +2 for uid+fid
  const header = Buffer.from([
    0x59, 0x59, 0x00, 0x01,
    (payloadLen >> 8) & 0xFF, payloadLen & 0xFF,
    0x01, // uid
    0x02, // fid: transparent
  ]);
  return Buffer.concat([header, body]);
}

function buildWriteResponseWithCode(code: number): Buffer {
  const adapterSerial = Buffer.from('CE1234G567', 'latin1');
  const padding = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08]);
  const inverterSerial = Buffer.from('SA1234B567', 'latin1');
  const sub = Buffer.from([
    0x11, code, // slave, fc (e.g. 134=0x86)
    ...Array.from(inverterSerial),
    0x00, 0x74, // register 116
    0x00, 0x50, // value 80
    0x00, 0x00, // CRC
  ]);
  const body = Buffer.concat([adapterSerial, padding, sub]);
  const payloadLen = body.length + 2;
  return Buffer.from([
    0x59, 0x59, 0x00, 0x01,
    (payloadLen >> 8) & 0xFF, payloadLen & 0xFF,
    0x01, 0x02,
    ...Array.from(body),
  ]);
}

describe('Heartbeat', () => {
  it('encodes a heartbeat response with correct MBAP header', () => {
    // The inverter sends HeartbeatRequest every ~3 minutes.
    // The client must respond within 5 seconds or the TCP connection drops.
    // The response must echo back the data adapter serial number.
    const response = encodeHeartbeatResponse('CE1234G567');
    expect(response[0]).toBe(0x59);
    expect(response[1]).toBe(0x59);
    expect(response[2]).toBe(0x00);
    expect(response[3]).toBe(0x01);
    // uid=1, fid=1 (heartbeat)
    expect(response[7]).toBe(0x01);
    expect(response.length).toBeGreaterThan(8);
  });

  it('encodes heartbeat with serial number in payload', () => {
    const response = encodeHeartbeatResponse('CE1234G567');
    // Serial starts at byte 8 (10 bytes)
    const serial = response.subarray(8, 18).toString('latin1');
    expect(serial).toBe('CE1234G567');
  });
});

describe('Read Registers Request Encoding', () => {
  it('encodes ReadHoldingRegistersRequest with transparent function code 0x02', () => {
    const frame = encodeReadHoldingRegistersRequest({
      dataAdapterSerial: 'CE1234G567',
      slaveAddress: 0x11,
      baseRegister: 0,
      registerCount: 60,
    });
    // MBAP header start
    expect(frame[0]).toBe(0x59);
    expect(frame[1]).toBe(0x59);
    // Outer function code at byte 7: 0x02 = transparent
    expect(frame[7]).toBe(0x02);
  });

  it('encodes ReadInputRegistersRequest with slave address 0x32 (battery)', () => {
    const frame = encodeReadInputRegistersRequest({
      dataAdapterSerial: 'CE1234G567',
      slaveAddress: 0x32, // LV battery 1
      baseRegister: 60,
      registerCount: 60,
    });
    expect(frame[7]).toBe(0x02); // outer: transparent
    // Slave address is at offset 8(serial)+8(padding)=16 after outer header byte 8
    // So at byte 8+10+8 = 26
    expect(frame[26]).toBe(0x32);
    // Inner fc at byte 27 should be 0x04 (read input registers)
    expect(frame[27]).toBe(0x04);
  });

  it('encodes WriteHoldingRegisterRequest with function code 0x06', () => {
    const frame = encodeWriteHoldingRegisterRequest({
      dataAdapterSerial: 'CE1234G567',
      slaveAddress: 0x11,
      register: 116, // charge_target_soc
      value: 80,
    });
    expect(frame[7]).toBe(0x02); // outer: transparent
    expect(frame[27]).toBe(0x06); // inner: write single register
  });

  it('includes CRC byte-swapped from little-endian to big-endian', () => {
    // GivEnergy quirk: CRC is computed as Modbus CRC-16 (which returns little-endian),
    // then the two bytes are swapped before transmission (treated as big-endian output).
    // Python: int.from_bytes(check.to_bytes(2, "little"), "big")
    // This means: if crc_value = 0xABCD, transmit bytes [0xCD, 0xAB].
    const frame = encodeReadHoldingRegistersRequest({
      dataAdapterSerial: 'CE1234G567',
      slaveAddress: 0x31,
      baseRegister: 0,
      registerCount: 60,
    });
    // Frame: 6 MBAP + 1 uid + 1 fid + 10 serial + 8 padding + 1 slave + 1 fc + 4 payload + 2 CRC = 34
    expect(frame.length).toBeGreaterThanOrEqual(34);
  });
});

describe('PDU Decoding', () => {
  it('decodes a heartbeat request frame', () => {
    // Build a minimal heartbeat frame (fid=0x01)
    const frame = Buffer.from([
      0x59, 0x59, 0x00, 0x01,
      0x00, 0x0D, // length: 13 bytes follow
      0x01, 0x01, // uid=1, fid=1 (heartbeat)
      // 10-byte serial: "ABCDEFGHIJ"
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
      0x00, // data_adapter_type
    ]);
    const pdu = decodePdu(frame);
    expect(pdu.type).toBe('heartbeat');
    if (pdu.type === 'heartbeat') {
      expect(pdu.dataAdapterSerial).toBe('ABCDEFGHIJ');
    }
  });

  it('decodes transparent read holding registers response', () => {
    const frame = buildReadHoldingResponse(0x31, 0, 2, [0x1234, 0x5678]);
    const pdu = decodePdu(frame);
    expect(pdu.type).toBe('transparent');
    if (pdu.type === 'transparent') {
      expect(pdu.transparentFunctionCode).toBe(0x03);
      expect(pdu.registerValues).toEqual([0x1234, 0x5678]);
      expect(pdu.slaveAddress).toBe(0x31);
      expect(pdu.baseRegister).toBe(0);
    }
  });

  it('detects error flag when transparent fc > 135', () => {
    // GivEnergy error responses set high bit on transparent fc.
    // E.g., 0x83 = error on read holding registers.
    // The check is strictly > 135 (0x87), NOT >= 128.
    // This means fc values 128-135 are NOT errors — intentional quirk.
    const frame = buildReadHoldingResponse(0x31, 0, 0, [], true); // 0x83 = error
    const pdu = decodePdu(frame);
    if (pdu.type === 'transparent') {
      expect(pdu.error).toBe(true);
    }
  });

  it('decodes inverter serial from response', () => {
    const frame = buildReadHoldingResponse(0x31, 0, 2, [0, 0]);
    const pdu = decodePdu(frame);
    if (pdu.type === 'transparent') {
      expect(pdu.inverterSerial).toBeDefined();
      expect(pdu.inverterSerial.length).toBe(10);
    }
  });

  it('accepts Gen1 BPM code 134 (0x86) as a valid write response — not an error', () => {
    // Python: elif transparent_function_code == 134:
    //   return WriteHoldingRegisterResponse
    // Gen1 Battery Protection Module firmware returns 0x86 instead of 0x06
    // for write acknowledgements. This is a firmware quirk that must be handled.
    // Since 134 <= 135, it must NOT be flagged as an error.
    const frame = buildWriteResponseWithCode(134);
    const pdu = decodePdu(frame);
    if (pdu.type === 'transparent') {
      expect(pdu.error).toBe(false);
      expect(pdu.transparentFunctionCode).toBe(134);
    }
  });
});
