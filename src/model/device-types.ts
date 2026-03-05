/**
 * GivEnergy inverter device type detection.
 *
 * The device_type_code register (HR 0) encodes the inverter model.
 * Detection uses positional hex string parsing — fragile but matches GivTCP exactly.
 *
 * Python: hex(device_type_code)[2:3] gets the digit after "0x".
 * In JS: deviceTypeCode.toString(16)[0] gives the same digit.
 *
 * Reference: GivTCP/givenergy_modbus_async/model/register.py get_model()
 */

export enum DeviceType {
  HYBRID_GEN1 = 'HYBRID_GEN1',
  HYBRID_GEN2 = 'HYBRID_GEN2',
  HYBRID_GEN3 = 'HYBRID_GEN3',
  HYBRID_HV_GEN3 = 'HYBRID_HV_GEN3',
  AC = 'AC',
  AC_3PH = 'AC_3PH',
  HYBRID_3PH = 'HYBRID_3PH',
  EMS = 'EMS',
  GATEWAY = 'GATEWAY',
  ALL_IN_ONE = 'ALL_IN_ONE',
  ALL_IN_ONE_HYBRID = 'ALL_IN_ONE_HYBRID',
}

/** HV (High Voltage) device types — use BCU battery architecture (slave 0x70+) */
const HV_DEVICE_TYPES = new Set<DeviceType>([
  DeviceType.ALL_IN_ONE,
  DeviceType.AC_3PH,
  DeviceType.HYBRID_3PH,
  DeviceType.HYBRID_HV_GEN3,
  DeviceType.ALL_IN_ONE_HYBRID,
]);

/**
 * Detect inverter model from HR(0) device_type_code and HR(21) arm_firmware_version.
 *
 * FRAGILE: hex digit positional parsing mirrors GivTCP Python exactly.
 * In Python: hex(0x2003) = "0x2003", [2:3] = "2"
 * In JS:     (0x2003).toString(16) = "2003", [0] = "2"  ← same result
 */
export function detectModel(deviceTypeCode: number, armFirmwareVersion: number): DeviceType {
  const prefix = deviceTypeCode.toString(16)[0];

  switch (prefix) {
    case '2': {
      const gen = Math.floor(armFirmwareVersion / 100);
      if (gen === 3) return DeviceType.HYBRID_GEN3;
      if (gen === 8 || gen === 9) return DeviceType.HYBRID_GEN2;
      return DeviceType.HYBRID_GEN1;
    }
    case '3': return DeviceType.AC;
    case '4': return DeviceType.HYBRID_3PH;
    case '5': return DeviceType.EMS;
    case '7': return DeviceType.GATEWAY;
    case '8': return DeviceType.ALL_IN_ONE;
    default:  return DeviceType.HYBRID_GEN2;
  }
}

/**
 * Returns true for HV (High Voltage) battery architecture.
 * HV batteries use BCU slave addresses (0x70+) rather than LV (0x32-0x37).
 */
export function isHighVoltage(deviceType: DeviceType): boolean {
  return HV_DEVICE_TYPES.has(deviceType);
}
