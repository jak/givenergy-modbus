import { PayloadEncoder } from '../../src/codec.js';

/**
 * Build a mock GivEnergy transparent response frame for a read holding
 * registers request (slave=0x11, fc=0x03, base=0, count=registers.length).
 *
 * @param registers - Array of 16-bit register values to include in the response.
 */
export function buildMockResponse(registers: number[]): Buffer {
  const serial = '**********';
  const inverterSerial = '**********';
  const slaveAddress = 0x11;
  const fc = 0x03;
  const baseRegister = 0;
  const registerCount = registers.length;

  const crcEnc = new PayloadEncoder();
  crcEnc.addUint8(slaveAddress);
  crcEnc.addUint8(fc);
  crcEnc.addString(inverterSerial, 10);
  crcEnc.addUint16(baseRegister);
  crcEnc.addUint16(registerCount);
  for (const val of registers) crcEnc.addUint16(val);
  const crc = crcEnc.crc;
  const swappedCrc = ((crc & 0xFF) << 8) | ((crc >> 8) & 0xFF);

  const bodyEnc = new PayloadEncoder();
  bodyEnc.addUint8(0x01); // uid
  bodyEnc.addUint8(0x02); // fid: transparent
  bodyEnc.addString(serial, 10);
  // 8-byte padding
  for (let i = 0; i < 7; i++) bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x08);
  bodyEnc.addUint8(slaveAddress);
  bodyEnc.addUint8(fc);
  bodyEnc.addString(inverterSerial, 10);
  bodyEnc.addUint16(baseRegister);
  bodyEnc.addUint16(registerCount);
  for (const val of registers) bodyEnc.addUint16(val);
  bodyEnc.addUint16(swappedCrc);

  const body = bodyEnc.payload;
  const frameEnc = new PayloadEncoder();
  frameEnc.addUint16(0x5959); // TID
  frameEnc.addUint16(0x0001); // protocol ID
  frameEnc.addUint16(body.length);
  for (const byte of body) frameEnc.addUint8(byte);
  return frameEnc.payload;
}

/**
 * Encode a string (up to 10 chars) into register values (high byte, low byte).
 */
export function stringToRegisters(str: string): number[] {
  const padded = str.padEnd(10, '\x00');
  const regs: number[] = [];
  for (let i = 0; i < 10; i += 2) {
    regs.push((padded.charCodeAt(i) << 8) | padded.charCodeAt(i + 1));
  }
  return regs;
}
