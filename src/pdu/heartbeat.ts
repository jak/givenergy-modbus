import { PayloadEncoder } from '../codec.js';

/**
 * Encode a heartbeat response frame.
 *
 * GivEnergy inverters send a HeartbeatRequest (fid=0x01) every ~3 minutes.
 * The client must respond within 5 seconds or the TCP connection drops.
 * The response echoes back the data adapter serial number.
 */
export function encodeHeartbeatResponse(dataAdapterSerial: string): Buffer {
  const enc = new PayloadEncoder();
  // MBAP-style header: tid=0x5959, pid=0x0001
  enc.addUint16(0x5959);
  enc.addUint16(0x0001);
  // Length field = uid(1) + fid(1) + serial(10) + data_adapter_type(1) = 13
  enc.addUint16(13);
  enc.addUint8(0x01); // uid
  enc.addUint8(0x01); // fid: heartbeat
  enc.addString(dataAdapterSerial, 10); // 10-byte serial, left-padded with '*'
  enc.addUint8(0x00); // data_adapter_type
  return enc.payload;
}
