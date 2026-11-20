import { EventEmitter } from 'events';
import { PollManager, type PollTiming } from './poll-manager.js';
import { encodeReadHoldingRegistersRequest } from './pdu/encode.js';
import { Client } from './client.js';
import { registersToString } from './model/converters.js';
import { isPlantController, layoutOf, resolveModel } from './model/models.js';
import type { InverterModel, Layout, SinglePhaseModel, ThreePhaseModel } from './model/models.js';
import type { Capabilities } from './model/capabilities.js';
import type { BatteryPause, InverterSnapshot } from './model/snapshot.js';
import {
  isSupported,
  registerFor,
  SETTINGS,
  type SettingDefinition,
  type SettingWriteValue,
  type UnsafeSettingKey,
  type WritableSettingKey,
} from './catalogue/index.js';
import { encodeSetting, timeToInt, validateTime } from './catalogue/codec.js';
import { PAUSE_MODES } from './snapshot/schedules.js';
import { slotRegistersFor, type SlotRegisters } from './timeslot-registers.js';
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

/** A charge or discharge slot to write. Times are `"HH:MM"`. */
export interface TimeSlotInput {
  start: string;
  end: string;
  /**
   * Charge slots: the state of charge to charge up to. Discharge slots: the state of charge to
   * stop discharging at. 4–100. Only with `capabilities.perSlotTargets`, and never on three-phase
   * slots 1/2, which have no target register.
   */
  targetStateOfCharge?: number;
}

/** A slot with its number, from 1, as `getData().schedules` lists them, so an entry can be written back. */
export interface NumberedTimeSlotInput extends TimeSlotInput {
  slot: number;
}

/** Battery pause to write. `start`/`end` (`"HH:MM"`) need `capabilities.pauseWindow`; give both or neither. */
export interface BatteryPauseInput {
  mode: Exclude<BatteryPause['mode'], 'unknown'>;
  start?: string;
  end?: string;
}

/** The model type for layout `L`. */
export type ModelOf<L extends Layout> = L extends 'three_phase' ? ThreePhaseModel : SinglePhaseModel;
/** The snapshot type for layout `L`. */
export type SnapshotOf<L extends Layout> = Extract<InverterSnapshot, { layout: L }>;

const INVERTER_SLAVE = 0x11;
/** HR 163: writing 100 restarts the inverter. */
const REBOOT_REGISTER = 163;
const REBOOT_VALUE = 100;
/** HR 318–320: battery pause mode, window start, window end. */
const PAUSE_MODE_REGISTER = 318;
const PAUSE_START_REGISTER = 319;
const PAUSE_END_REGISTER = 320;
/** Per-slot targets take 4–100, as the external library validates them. */
const SLOT_TARGET_MIN = 4;
const SLOT_TARGET_MAX = 100;
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
   * Quirk: a reply with function code 0x86 counts as accepted. Gen1 battery management firmware
   * echoes writes with 0x86 instead of 6, so 0x86 can't be told apart from a Modbus error reply
   * to a write (as in 2.x). Any other error reply never matches the write, so it times out.
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

  /**
   * Write one charge slot, numbered from 1 up to the model's slot count (10 with
   * `capabilities.tenSlots`, otherwise 2). Accepts an entry of `getData().schedules.charge`.
   * Slot 2 is HR 243/244 on ten-slot firmware and HR 31/32 otherwise.
   *
   * @throws RangeError for a slot number out of range, an invalid time or target.
   * @throws UnsupportedSettingError for a `targetStateOfCharge` the slot has no register for.
   */
  setChargeSlot(slot: number, config: TimeSlotInput): Promise<void>;
  setChargeSlot(config: NumberedTimeSlotInput): Promise<void>;
  async setChargeSlot(slotOrConfig: number | NumberedTimeSlotInput, config?: TimeSlotInput): Promise<void> {
    await this._writeSlots('charge', [numbered(slotOrConfig, config)], false);
  }

  /** Write one discharge slot. As `setChargeSlot`; slot 2 is HR 44/45 on every single-phase model. */
  setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void>;
  setDischargeSlot(config: NumberedTimeSlotInput): Promise<void>;
  async setDischargeSlot(slotOrConfig: number | NumberedTimeSlotInput, config?: TimeSlotInput): Promise<void> {
    await this._writeSlots('discharge', [numbered(slotOrConfig, config)], false);
  }

  /**
   * Write all charge slots: `configs[i]` to slot i + 1, and clear every slot after the last one
   * to 00:00–00:00. Clearing writes the times only and leaves targets as they are, as the external
   * library's `reset_charge_slot` does, so a cleared slot keeps its old target (and the snapshot
   * shows it on the empty slot). An entry's `slot`, when given, must match its position.
   */
  async setChargeSlots(configs: readonly (TimeSlotInput | NumberedTimeSlotInput)[]): Promise<void> {
    await this._writeSlots('charge', positional(configs), true);
  }

  /** Write all discharge slots, clearing the rest. As `setChargeSlots`. */
  async setDischargeSlots(configs: readonly (TimeSlotInput | NumberedTimeSlotInput)[]): Promise<void> {
    await this._writeSlots('discharge', positional(configs), true);
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

  /**
   * Write registers in order, then show them in the snapshot with one `data` event. If a write
   * fails, the ones before it (which the inverter accepted) are still applied, and the error is
   * rethrown; the failed one and those after it leave the cache alone.
   */
  protected async _writeAll(writes: ReadonlyArray<readonly [register: number, raw: number]>): Promise<void> {
    const accepted: Array<readonly [number, number]> = [];
    try {
      for (const write of writes) {
        await this.pollManager.writeHoldingRegister(write[0], write[1]);
        accepted.push(write);
      }
    } finally {
      if (accepted.length > 0) this.pollManager.applyWrites(accepted);
    }
  }

  protected _unsupported(key: string): UnsupportedSettingError {
    return new UnsupportedSettingError(key, this.model, this.pollManager.armFirmwareVersion);
  }

  /** Validate every slot first, so a bad entry writes nothing; then write them in order. */
  private async _writeSlots(kind: 'charge' | 'discharge', entries: NumberedTimeSlotInput[], clearRest: boolean): Promise<void> {
    const table = slotRegistersFor(this.layout, this.capabilities, kind);
    if (clearRest && entries.length > table.length) {
      throw new RangeError(`${kind} slots: ${entries.length} given, this inverter has ${table.length}`);
    }
    const writes: Array<[number, number]> = [];
    for (const entry of entries) writes.push(...this._slotWrites(kind, table, entry));
    if (clearRest) {
      for (const registers of table.slice(entries.length)) writes.push([registers.start, 0], [registers.end, 0]);
    }
    await this._writeAll(writes);
  }

  private _slotWrites(kind: 'charge' | 'discharge', table: SlotRegisters[], entry: NumberedTimeSlotInput): Array<[number, number]> {
    const { slot, start, end, targetStateOfCharge } = entry;
    if (!Number.isInteger(slot) || slot < 1 || slot > table.length) {
      throw new RangeError(`${kind} slot must be 1-${table.length}, got ${slot}`);
    }
    const registers = table[slot - 1];
    validateTime(start);
    validateTime(end);
    const writes: Array<[number, number]> = [[registers.start, timeToInt(start)], [registers.end, timeToInt(end)]];
    if (targetStateOfCharge !== undefined) {
      if (registers.targetStateOfCharge === undefined) throw this._unsupported(`${kind}SlotTargetStateOfCharge`);
      if (!Number.isInteger(targetStateOfCharge) || targetStateOfCharge < SLOT_TARGET_MIN || targetStateOfCharge > SLOT_TARGET_MAX) {
        throw new RangeError(`target state of charge must be an integer ${SLOT_TARGET_MIN}-${SLOT_TARGET_MAX}, got ${targetStateOfCharge}`);
      }
      writes.push([registers.targetStateOfCharge, targetStateOfCharge]);
    }
    return writes;
  }

  private async _write(key: string, value: unknown, allowUnsafe: boolean): Promise<void> {
    const definition: SettingDefinition | undefined = (SETTINGS as Record<string, SettingDefinition>)[key];
    if (!definition) throw new TypeError(`unknown setting "${key}"`);
    // The types already rule these out; these checks catch callers that bypass them.
    if (definition.writable === false) throw new TypeError(`${key} is read only`);
    if (definition.unsafe && !allowUnsafe) throw new TypeError(`${key} is unsafe; write it with unsafe_setSetting`);

    const settingKey = key as keyof typeof SETTINGS;
    if (!isSupported(settingKey, this.layout, this.capabilities)) throw this._unsupported(key);
    // isSupported checked that the setting has a register on this layout.
    const register = registerFor(settingKey, this.layout)!;
    const raw = encodeSetting(definition, value as never);
    await this._writeAll([[register, raw]]);
  }
}

function numbered(slotOrConfig: number | NumberedTimeSlotInput, config?: TimeSlotInput): NumberedTimeSlotInput {
  if (typeof slotOrConfig !== 'number') return slotOrConfig;
  if (!config) throw new TypeError('a slot config is required');
  return { ...config, slot: slotOrConfig };
}

function positional(configs: readonly (TimeSlotInput | NumberedTimeSlotInput)[]): NumberedTimeSlotInput[] {
  return configs.map((config, index) => {
    if ('slot' in config && config.slot !== index + 1) {
      throw new RangeError(`slot ${config.slot} given at position ${index + 1}; list slots in order from 1`);
    }
    return { ...config, slot: index + 1 };
  });
}

/** A single-phase inverter: Hybrid Gen1–Gen4, AC, All in One, PV and others. */
export class SinglePhaseInverter extends GivEnergyInverter<'single_phase'> {
  readonly layout = 'single_phase' as const;

  /** @internal Use `GivEnergyInverter.connect()`. */
  constructor(pollManager: PollManager) {
    super(pollManager);
  }

  /**
   * Set the battery pause: HR 318 (mode), then HR 319 (start) and HR 320 (end), no swap. 2.x
   * swapped the window registers; the app shows HR 319 as the start.
   *
   * @throws UnsupportedSettingError without `capabilities.pauseMode`, or for a window without
   * `capabilities.pauseWindow` (Gen1 and AC have the mode only; Gen1 rejects HR 319/320).
   * @throws RangeError for an unknown mode, an invalid time, or only one of start and end.
   */
  async setBatteryPause(pause: BatteryPauseInput): Promise<void> {
    if (!this.capabilities.pauseMode) throw this._unsupported('batteryPause');
    const mode = PAUSE_MODES.indexOf(pause.mode);
    if (mode < 0) throw new RangeError(`unknown battery pause mode "${pause.mode}"`);
    const hasWindow = pause.start !== undefined || pause.end !== undefined;
    if (hasWindow) {
      if (!this.capabilities.pauseWindow) throw this._unsupported('batteryPauseWindow');
      if (pause.start === undefined || pause.end === undefined) throw new RangeError('give both start and end, or neither');
      validateTime(pause.start);
      validateTime(pause.end);
    }
    await this._writeAll([
      [PAUSE_MODE_REGISTER, mode],
      ...(hasWindow
        ? [[PAUSE_START_REGISTER, timeToInt(pause.start!)], [PAUSE_END_REGISTER, timeToInt(pause.end!)]] as const
        : []),
    ]);
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
