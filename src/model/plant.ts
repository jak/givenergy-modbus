/**
 * Plant (inverter + battery system) configuration detection.
 *
 * Reference: GivTCP/givenergy_modbus_async/model/plant.py
 */

import { DeviceType } from './device-types.js';
import { registersToString } from './converters.js';

/** LV battery slave addresses: battery 1=0x32 through battery 6=0x37 */
const LV_BATTERY_SLAVE_ADDRESSES = [0x32, 0x33, 0x34, 0x35, 0x36, 0x37];

/** Battery serial number: IR(110-114), 5 registers × 2 bytes = 10-char string */
const SERIAL_START = 110;
const SERIAL_LENGTH = 5;

const INVALID_SERIALS = new Set([
  '\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
  '          ',
  '',
]);

/**
 * Detect the number of connected batteries.
 *
 * For LV: scans slave addresses 0x32-0x37, stops at first invalid serial.
 * EMS/Gateway: always 0 (no directly connected batteries).
 * HV: reads BCU count from BAMS register cache at slave 0xA0.
 */
export function detectBatteries(
  registerCache: Map<number, Map<number, number>>,
  highVoltage: boolean,
  deviceType?: DeviceType,
): number {
  if (deviceType === DeviceType.EMS || deviceType === DeviceType.GATEWAY) {
    return 0;
  }
  if (highVoltage) {
    // HV: read BCU count from BAMS at slave 0xA0, IR(61)
    const bamsCache = registerCache.get(0xa0);
    if (!bamsCache) return 0;
    return bamsCache.get(61) ?? 0;
  }

  let count = 0;
  for (const addr of LV_BATTERY_SLAVE_ADDRESSES) {
    const cache = registerCache.get(addr);
    if (!cache) break;

    const regs: number[] = [];
    for (let i = 0; i < SERIAL_LENGTH; i++) {
      regs.push(cache.get(SERIAL_START + i) ?? 0);
    }
    const serial = registersToString(regs);
    if (INVALID_SERIALS.has(serial)) break;

    count++;
  }
  return count;
}
