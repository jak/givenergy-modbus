import { PayloadEncoder } from '../codec.js';

export interface ReadRegistersRequest {
  dataAdapterSerial: string;
  slaveAddress: number;
  baseRegister: number;
  registerCount: number;
}

export interface WriteHoldingRegisterRequest {
  dataAdapterSerial: string;
  slaveAddress: number;
  register: number;
  value: number;
}

/**
 * Build a complete GivEnergy transparent frame.
 *
 * Frame layout:
 *   Bytes 0-1:   TID 0x5959
 *   Bytes 2-3:   protocol ID 0x0001
 *   Bytes 4-5:   length (everything after this field)
 *   Byte  6:     uid (0x01)
 *   Byte  7:     fid (0x02 = transparent)
 *   Bytes 8-17:  data_adapter_serial (10 bytes, latin1)
 *   Bytes 18-25: padding 0x08 0x00 0x00 0x00 0x00 0x00 0x00 0x00
 *   Byte  26:    slave_address
 *   Byte  27:    transparent_function_code
 *   Bytes 28+:   inner payload
 *   Last 2:      CRC (byte-swapped Modbus CRC-16)
 *
 * CRC is computed over: slave_address + fc + inner_payload.
 * GivEnergy quirk: the CRC bytes are swapped before transmission.
 */
function buildTransparentFrame(
  dataAdapterSerial: string,
  slaveAddress: number,
  innerFc: number,
  innerPayload: Buffer,
): Buffer {
  // Compute CRC over: slave + fc + innerPayload
  const crcEnc = new PayloadEncoder();
  crcEnc.addUint8(slaveAddress);
  crcEnc.addUint8(innerFc);
  for (const byte of innerPayload) {
    crcEnc.addUint8(byte);
  }
  const crc = crcEnc.crc;
  // GivEnergy byte-swap: swap low and high bytes of the CRC
  const swappedCrc = ((crc & 0xFF) << 8) | ((crc >> 8) & 0xFF);

  // Build the frame body (everything after the 6-byte MBAP prefix)
  const bodyEnc = new PayloadEncoder();
  bodyEnc.addUint8(0x01); // uid
  bodyEnc.addUint8(0x02); // fid: transparent
  bodyEnc.addString(dataAdapterSerial, 10);
  // 8-byte padding: 64-bit big-endian uint with value 0x08
  bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x08);
  bodyEnc.addUint8(slaveAddress);
  bodyEnc.addUint8(innerFc);
  for (const byte of innerPayload) {
    bodyEnc.addUint8(byte);
  }
  bodyEnc.addUint16(swappedCrc);

  const body = bodyEnc.payload;

  // Build the full frame with MBAP header
  const frameEnc = new PayloadEncoder();
  frameEnc.addUint16(0x5959); // TID
  frameEnc.addUint16(0x0001); // protocol ID
  frameEnc.addUint16(body.length); // length = everything after this field (uid onward)
  for (const byte of body) {
    frameEnc.addUint8(byte);
  }

  return frameEnc.payload;
}

/**
 * Encode a Read Holding Registers request (Modbus fc=0x03).
 */
export function encodeReadHoldingRegistersRequest(req: ReadRegistersRequest): Buffer {
  const innerEnc = new PayloadEncoder();
  innerEnc.addUint16(req.baseRegister);
  innerEnc.addUint16(req.registerCount);
  return buildTransparentFrame(req.dataAdapterSerial, req.slaveAddress, 0x03, innerEnc.payload);
}

/**
 * Encode a Read Input Registers request (Modbus fc=0x04).
 */
export function encodeReadInputRegistersRequest(req: ReadRegistersRequest): Buffer {
  const innerEnc = new PayloadEncoder();
  innerEnc.addUint16(req.baseRegister);
  innerEnc.addUint16(req.registerCount);
  return buildTransparentFrame(req.dataAdapterSerial, req.slaveAddress, 0x04, innerEnc.payload);
}

/**
 * Encode a Write Single Holding Register request (Modbus fc=0x06).
 */
export function encodeWriteHoldingRegisterRequest(req: WriteHoldingRegisterRequest): Buffer {
  const innerEnc = new PayloadEncoder();
  innerEnc.addUint16(req.register);
  innerEnc.addUint16(req.value);
  return buildTransparentFrame(req.dataAdapterSerial, req.slaveAddress, 0x06, innerEnc.payload);
}
