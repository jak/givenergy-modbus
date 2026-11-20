import type { DeviceModel, InverterModel } from './model/models.js';

/**
 * The device at the address is not an inverter this library supports: a plant controller (an
 * Energy Management System or Gateway), or a device type code no known model has (including 0,
 * what a device that isn't a GivEnergy inverter reads back).
 */
export class UnsupportedDeviceError extends Error {
  override readonly name = 'UnsupportedDeviceError';

  constructor(
    readonly model: DeviceModel,
    /** HR 0. */
    readonly deviceTypeCode: number,
  ) {
    const code = `0x${deviceTypeCode.toString(16).padStart(4, '0')}`;
    super(
      model === 'unknown'
        ? `unsupported device: device type code ${code} is not a known GivEnergy inverter`
        : `unsupported device: ${model} (device type code ${code}) is a plant controller, not an inverter`,
    );
  }
}

/** The inverter's model or firmware doesn't support the setting. */
export class UnsupportedSettingError extends Error {
  override readonly name = 'UnsupportedSettingError';

  constructor(
    readonly key: string,
    readonly model: InverterModel,
    /** ARM firmware version. */
    readonly firmware: number,
  ) {
    super(`${key} is not supported on ${model} with ARM firmware ${firmware}`);
  }
}
