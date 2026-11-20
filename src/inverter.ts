import { EventEmitter } from 'events';
import { PollManager, type PollTiming } from './poll-manager.js';
import { encodeReadHoldingRegistersRequest } from './pdu/encode.js';
import { Client } from './client.js';
import { registersToString } from './model/converters.js';
import { isPlantController, layoutOf, resolveModel } from './model/models.js';
import type { InverterModel, Layout, SinglePhaseModel, ThreePhaseModel } from './model/models.js';
import type { Capabilities } from './model/capabilities.js';
import type { InverterSnapshot, SinglePhaseSnapshot, ThreePhaseSnapshot } from './model/snapshot.js';
import {
  isSupported,
  registerFor,
  SETTINGS,
  type SettingDefinition,
  type SettingWriteValue,
  type UnsafeSettingKey,
  type WritableSettingKey,
} from './catalogue/index.js';
import { encodeSetting } from './catalogue/codec.js';
import { UnsupportedDeviceError, UnsupportedSettingError } from './errors.js';

export interface GivEnergyInverterOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;
  autoReconnect?: boolean;
  reconnectBackoffMs?: number;
  reconnectMaxBackoffMs?: number;
  /** @internal Request timing, shortened by tests. */
  timing?: Partial<PollTiming>;
}

/** What `GivEnergyInverter.identify` reads from HR 0–59. */
export interface InverterIdentity {
  serialNumber: string;
  /** HR 0. */
  deviceTypeCode: number;
  model: InverterModel;
  layout: Layout;
}

/** The model type for layout `L`. */
export type ModelOf<L extends Layout> = L extends 'three_phase' ? ThreePhaseModel : SinglePhaseModel;
/** The snapshot type for layout `L`. */
export type SnapshotOf<L extends Layout> = Extract<InverterSnapshot, { layout: L }>;

const INVERTER_SLAVE = 0x11;
/** HR 163: writing 100 restarts the inverter. */
const REBOOT_REGISTER = 163;
const REBOOT_VALUE = 100;
/** HR 35–40: system clock, year as an offset from 2000. */
const SYSTEM_TIME_REGISTER = 35;

function trimSerial(raw: string): string {
  return raw.replace(/\0/g, '').trim();
}

/**
 * A GivEnergy inverter. Create one with `GivEnergyInverter.connect()`, which returns a
 * `SinglePhaseInverter` or `ThreePhaseInverter` depending on the model.
 *
 * Events: `data` (snapshot), `lost` (error), `reconnecting` (attempt, nextRetryMs), `reconnected`, `debug` (message).
 */
export abstract class GivEnergyInverter<L extends Layout = Layout> extends EventEmitter {
  abstract readonly layout: L;
  protected readonly pollManager: PollManager;

  protected constructor(pollManager: PollManager) {
    super();
    this.pollManager = pollManager;
    this.pollManager.on('data', (snapshot: InverterSnapshot) => this.emit('data', snapshot));
    this.pollManager.on('lost', (err: Error) => this.emit('lost', err));
    this.pollManager.on('debug', (msg: string) => this.emit('debug', msg));
    this.pollManager.on('reconnecting', (attempt: number, nextRetryMs: number) =>
      this.emit('reconnecting', attempt, nextRetryMs),
    );
    this.pollManager.on('reconnected', () => this.emit('reconnected'));
  }

  /**
   * Connect, run the first full poll and return the inverter. Rejects with
   * `UnsupportedDeviceError` for a plant controller (EMS, Gateway) or an unknown device.
   */
  static async connect(options: GivEnergyInverterOptions): Promise<SinglePhaseInverter | ThreePhaseInverter> {
    const pollManager = new PollManager({
      host: options.host,
      port: options.port,
      pollIntervalMs: options.pollIntervalMs,
      autoReconnect: options.autoReconnect,
      reconnectBackoffMs: options.reconnectBackoffMs,
      reconnectMaxBackoffMs: options.reconnectMaxBackoffMs,
      timing: options.timing,
    });
    await pollManager.start();
    const snapshot = pollManager.getData();

    if (trimSerial(snapshot.identity.serialNumber) === '') {
      await pollManager.stop();
      throw new Error(`No valid inverter found at ${options.host} (empty serial number)`);
    }

    return snapshot.layout === 'three_phase'
      ? new ThreePhaseInverter(pollManager)
      : new SinglePhaseInverter(pollManager);
  }

  /**
   * Lightweight identity probe: reads only HR 0–59 (one request) to get the serial number and
   * model without starting a poll. For pairing and discovery. Rejects with
   * `UnsupportedDeviceError` for a plant controller or an unknown device type code.
   */
  static async identify(options: { host: string; port?: number; timeout?: number; retries?: number }): Promise<InverterIdentity> {
    const client = new Client({
      host: options.host,
      port: options.port ?? 8899,
      timeout: options.timeout ?? 10_000,
      retries: options.retries ?? 1,
    });
    try {
      await client.connect();
      const frame = encodeReadHoldingRegistersRequest({
        dataAdapterSerial: client.dataAdapterSerial,
        slaveAddress: INVERTER_SLAVE,
        baseRegister: 0,
        registerCount: 60,
      });
      const values = await client.sendRequest(frame);

      const serialNumber = trimSerial(registersToString([13, 14, 15, 16, 17].map(i => values[i] ?? 0)));
      if (serialNumber === '') {
        throw new Error(`No valid inverter found at ${options.host} (empty serial number)`);
      }

      const deviceTypeCode = values[0] ?? 0;
      const model = resolveModel(deviceTypeCode, values[21] ?? 0);
      if (model === 'unknown' || isPlantController(model)) throw new UnsupportedDeviceError(model, deviceTypeCode);
      return { serialNumber, deviceTypeCode, model, layout: layoutOf(model) };
    } finally {
      await client.close();
    }
  }

  get model(): ModelOf<L> {
    return this.pollManager.model as ModelOf<L>;
  }

  /** What this inverter supports: from the model and firmware, minus blocks it never answered. */
  get capabilities(): Capabilities {
    return this.pollManager.capabilities;
  }

  getData(): SnapshotOf<L> {
    return this.pollManager.getData() as SnapshotOf<L>;
  }

  async stop(): Promise<void> {
    return this.pollManager.stop();
  }

  /**
   * Write a setting from the catalogue (`SETTINGS`). The snapshot reflects the new value as soon
   * as the inverter accepts the write, without waiting for the next poll.
   *
   * @throws UnsupportedSettingError when the model or firmware doesn't support the setting.
   * @throws RangeError or TypeError for a value the setting doesn't accept.
   */
  async setSetting<K extends WritableSettingKey<L>>(key: K, value: SettingWriteValue<K>): Promise<void> {
    await this._write(key, value, false);
  }

  /**
   * Write a setting that no reference implementation has verified. Each one can leave the
   * inverter in a state that's hard to recover remotely:
   *
   * - `batterySelfHeating`: Battery self-heating (HR 104). Undocumented: GivEnergy's v4.1.6
   *   register document marks HR 104 reserved and read-only, on three-phase models the same
   *   address is a grid power calibration value, and a write has been seen rejected with an error
   *   on real hardware. GivEnergy says its batteries have no active heating. Only write this if
   *   the official app offers and accepts it for your exact hardware.
   * - `manualBatteryHeater`: Manual battery heater (HR 172). Undocumented: the v4.1.6 register
   *   document marks HR 165–173 reserved and the installer app doesn't list it. On tested
   *   hardware the write was accepted but read back off. No GivEnergy battery is known to have a
   *   heater, and if one did, nothing documents an automatic cut-off. Don't write this register.
   * - `inverterParallelMode`: Parallel output mode (HR 199; "ParaOutputMode", values 0–4,
   *   although the app shows an on/off switch). A Gateway sets this when it commissions All in One
   *   units in parallel, and reboots them. Writing it on a standalone inverter is untested and may
   *   cause parallel faults or loss of output. This is not the "self-consumption logic" flag older
   *   libraries called it.
   * - `forceOffGrid`: Force off grid (HR 331; "GatewayOnOff", 0–255). Designed for All in One +
   *   Gateway systems: it disconnects the site from the grid and keeps it islanded until cleared.
   *   Off-grid output is limited (about 6 kW on an All in One), PV may be curtailed at high state
   *   of charge, RCDs may trip if the earthing wasn't designed for islanding, and if the battery
   *   reaches its cutoff the system can shut down with no way to recover it remotely. Behaviour on
   *   hybrids without a Gateway is unverified. Always pair a write with a guaranteed clear.
   *
   * @remarks Writes registers no reference implementation has verified. See each setting's `risk`.
   */
  async unsafe_setSetting<K extends UnsafeSettingKey<L>>(key: K, value: SettingWriteValue<K>): Promise<void> {
    await this._write(key, value, true);
  }

  /** Set the inverter clock (HR 35–40). */
  async setDateTime(date: Date): Promise<void> {
    const fields = [
      date.getFullYear() - 2000,
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
    ];
    for (const [offset, value] of fields.entries()) {
      await this.pollManager.writeHoldingRegister(SYSTEM_TIME_REGISTER + offset, value);
    }
  }

  /** Set the inverter clock to this machine's local time. */
  async syncDateTime(): Promise<void> {
    await this.setDateTime(new Date());
  }

  /** Restart the inverter (HR 163 = 100). */
  async reboot(): Promise<void> {
    await this.pollManager.writeHoldingRegister(REBOOT_REGISTER, REBOOT_VALUE);
  }

  /** Write any holding register, unchecked. The snapshot picks it up on the next poll. */
  async unsafe_writeRegister(register: number, value: number): Promise<void> {
    await this.pollManager.writeHoldingRegister(register, value);
  }

  private async _write(key: string, value: unknown, allowUnsafe: boolean): Promise<void> {
    const definition: SettingDefinition | undefined = (SETTINGS as Record<string, SettingDefinition>)[key];
    if (!definition) throw new TypeError(`unknown setting "${key}"`);
    // The types already rule these out; these checks catch callers that bypass them.
    if (definition.writable === false) throw new TypeError(`${key} is read only`);
    if (definition.unsafe && !allowUnsafe) throw new TypeError(`${key} is unsafe; write it with unsafe_setSetting`);

    const settingKey = key as keyof typeof SETTINGS;
    if (!isSupported(settingKey, this.layout, this.capabilities)) {
      throw new UnsupportedSettingError(key, this.model, this.pollManager.armFirmwareVersion);
    }
    // isSupported checked that the setting has a register on this layout.
    const register = registerFor(settingKey, this.layout)!;
    const raw = encodeSetting(definition, value as never);
    await this.pollManager.writeHoldingRegister(register, raw);
    this.pollManager.applyWrite(register, raw);
  }
}

/** A single-phase inverter: Hybrid Gen1–Gen4, AC, All in One, PV and others. */
export class SinglePhaseInverter extends GivEnergyInverter<'single_phase'> {
  readonly layout = 'single_phase' as const;

  /** @internal Use `GivEnergyInverter.connect()`. */
  constructor(pollManager: PollManager) {
    super(pollManager);
  }
}

/** A three-phase inverter: Hybrid 3-phase, AC 3-phase and the commercial All in One. */
export class ThreePhaseInverter extends GivEnergyInverter<'three_phase'> {
  readonly layout = 'three_phase' as const;

  /** @internal Use `GivEnergyInverter.connect()`. */
  constructor(pollManager: PollManager) {
    super(pollManager);
  }
}
