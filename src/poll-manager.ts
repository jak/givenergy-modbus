import { EventEmitter } from 'events';
import { Client } from './client.js';
import { UnsupportedDeviceError } from './errors.js';
import {
  encodeReadHoldingRegistersRequest,
  encodeReadInputRegistersRequest,
  encodeReadMeterProductRegistersRequest,
  encodeWriteHoldingRegisterRequest,
} from './pdu/encode.js';
import { capabilitiesFor, type Capabilities } from './model/capabilities.js';
import {
  isPlantController,
  layoutOf,
  resolveModel,
  type Layout,
  type SinglePhaseModel,
  type ThreePhaseModel,
} from './model/models.js';
import type { InverterSnapshot } from './model/snapshot.js';
import {
  blockCovers,
  effectiveCapabilities,
  holdingBlocksFor,
  inputBlocksFor,
  type RegisterBlock,
} from './poll-blocks.js';
import { buildSnapshot } from './snapshot/index.js';
import { isSanityCheckPassing } from './validation.js';
import { armFirmwareVersionOf } from './snapshot/identity.js';
import type { BatteryStackCaches, BuildContext, MeterCaches, RegisterCaches } from './snapshot/read.js';

export interface PollManagerOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;        // default 15000 (15s partial)
  fullRefreshIntervalMs?: number;  // default 60000 (60s full)
  autoReconnect?: boolean;         // default true
  reconnectBackoffMs?: number;     // initial backoff, default 5000
  reconnectMaxBackoffMs?: number;  // max backoff cap, default 300000 (5min)
  /** @internal Request timing, shortened by tests. */
  timing?: Partial<PollTiming>;
}

/** @internal */
export interface PollTiming {
  /** Per attempt. Default 10 s: the inverter takes 4–8 s to answer at first. */
  requestTimeoutMs: number;
  /** Retries after the first attempt, for inverter blocks. Default 3. */
  requestRetries: number;
  /**
   * Retries for battery and meter scan reads. Default 1: a device that answers does so within a
   * second once the link is up, a late reply still counts, and a silent address is dropped after
   * three full refreshes.
   */
  scanRetries: number;
  /** Pause before a retry, as the client's own retries. Default 500 ms. */
  retryDelayMs: number;
  /** Pause between sequential reads. Default 250 ms, GivTCP's inter-frame delay. */
  interReadDelayMs: number;
  /** Wait after the reads for the rest of the push data. Default 3 s. */
  pushSoakMs: number;
}

const DEFAULT_TIMING: PollTiming = {
  requestTimeoutMs: 10_000,
  requestRetries: 3,
  scanRetries: 1,
  retryDelayMs: 500,
  interReadDelayMs: 250,
  pushSoakMs: 3000,
};

const INVERTER_SLAVE = 0x11;
const FUNCTION_READ_HOLDING = 3;
const FUNCTION_READ_INPUT = 4;
const FUNCTION_READ_METER_PRODUCT = 22;

/** Battery and meter devices store their registers from IR 60. */
const DEVICE_REGISTER_START = 60;
const DEVICE_REGISTER_COUNT = 60;
/** Low-voltage battery management systems, one per module. */
const LOW_VOLTAGE_BATTERY_SLAVES = [0x32, 0x33, 0x34, 0x35, 0x36, 0x37];
const METER_SLAVES = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
const METER_DATA_REGISTER_COUNT = 29; // IR 60-88
const METER_PRODUCT_REGISTER_COUNT = 9; // function 22, 60-68
/** Battery aggregation and management system: IR 61 is the number of battery control units. */
const BATTERY_AGGREGATOR_SLAVE = 0xa0;
const BATTERY_AGGREGATOR_STACK_COUNT_REGISTER = 61;
/** Battery control unit n (one per stack) is at 0x70 + n. IR 64 is its module count. */
const BATTERY_CONTROL_UNIT_BASE_SLAVE = 0x70;
const BATTERY_CONTROL_UNIT_MODULE_COUNT_REGISTER = 64;
const MAX_BATTERY_STACKS = 8;
/**
 * Battery module k of every stack is at 0x50 + k; stack n's modules are read at IR 60 + 120 × n
 * and stored in `RegisterCaches` from IR 60.
 */
const BATTERY_MODULE_BASE_SLAVE = 0x50;
const BATTERY_MODULE_STACK_OFFSET = 120;
const MAX_BATTERY_MODULES = 16;

/**
 * A read (inverter block, battery slot, meter address) that goes unanswered this many live polls
 * in a row, with no reply or push data covering it, is no longer requested.
 */
const UNANSWERED_AFTER_MISSES = 3;

type RegisterType = 'holding' | 'input';

/** Every register value received from one device address, by function. */
interface DeviceRegisters {
  holding: Map<number, number>;
  input: Map<number, number>;
  product: Map<number, number>;
}

/** The model and layout, resolved once from the first HR 0 block. */
type Identified =
  | { model: SinglePhaseModel; layout: 'single_phase' }
  | { model: ThreePhaseModel; layout: 'three_phase' };

/** A read of `count` registers from `base` on one device address, with one function code. */
interface ReadRequest {
  slave: number;
  functionCode: typeof FUNCTION_READ_HOLDING | typeof FUNCTION_READ_INPUT | typeof FUNCTION_READ_METER_PRODUCT;
  base: number;
  count: number;
}

/** Register data received from any device: a matched reply, a late reply or push data. */
type ReceivedRange = ReadRequest;

const requestKey = ({ slave, functionCode, base }: ReadRequest) => `${slave}:${functionCode}:${base}`;

function requestLabel({ slave, functionCode, base, count }: ReadRequest): string {
  const kind = functionCode === FUNCTION_READ_HOLDING ? 'HR' : functionCode === FUNCTION_READ_INPUT ? 'IR' : 'product registers';
  const where = slave === INVERTER_SLAVE ? '' : `slave 0x${slave.toString(16).padStart(2, '0')} `;
  return `${where}${kind} ${base}–${base + count - 1}`;
}

/** Whether `range` holds every register `request` asks for. */
const coversAll = (range: ReceivedRange, request: ReadRequest) =>
  range.slave === request.slave && range.functionCode === request.functionCode
  && range.base <= request.base && range.base + range.count >= request.base + request.count;

/** Whether `range` holds at least the first register `request` asks for: enough to show the block answers. */
const coversStart = (range: ReceivedRange, request: ReadRequest) =>
  range.slave === request.slave && range.functionCode === request.functionCode
  && blockCovers(range, request.base);

const inverterRead = (type: RegisterType, { base, count }: RegisterBlock): ReadRequest => ({
  slave: INVERTER_SLAVE,
  functionCode: type === 'holding' ? FUNCTION_READ_HOLDING : FUNCTION_READ_INPUT,
  base,
  count,
});

/**
 * The holding half of the sanity check (GivTCP read.py): Modbus version (HR 34 ÷100) ≤ 2, Modbus
 * address (HR 30) and user code (HR 33) ≤ 100. A device answering all zeros passes.
 */
function holdingBlockLooksSane(holding: Map<number, number>): boolean {
  return isSanityCheckPassing({
    modbusVersion: (holding.get(34) ?? 0) / 100,
    modbusAddress: holding.get(30) ?? 0,
    userCode: holding.get(33) ?? 0,
    heatsinkTemp: 0,
  });
}


export class PollManager extends EventEmitter {
  private readonly client: Client;
  private readonly options: Required<Omit<PollManagerOptions, 'timing'>>;
  private readonly timing: PollTiming;
  private _cache: InverterSnapshot | null = null;
  private _started = false;
  private _failCount = 0;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _lastFullRefresh = 0;
  private _previousSnapshot: InverterSnapshot | null = null;
  private _polling = false;
  private _reconnecting = false;
  private _reconnectAbort = false;
  private _identified: Identified | null = null;
  /** Set once a snapshot built with `_identified` passes the sanity check; the model is then fixed. */
  private _modelConfirmed = false;
  /** Set when the device turned out not to be a supported inverter; `start()` rethrows it. */
  private _unsupported: UnsupportedDeviceError | null = null;

  /** Every register received, matched or pushed, by device address. */
  private readonly _devices = new Map<number, DeviceRegisters>();
  /** Register data received during the current poll, from any device. */
  private _receivedThisPoll: ReceivedRange[] = [];
  /** Requests waiting for data that covers them, whether or not it is their matched reply. */
  private readonly _waiting = new Set<{ request: ReadRequest; answer: () => void }>();
  /** Consecutive polls each read was requested and not answered, by `requestKey`. */
  private readonly _misses = new Map<string, number>();
  /** Reads no longer requested, by `requestKey`. */
  private readonly _unanswered = new Set<string>();
  /** Meters whose product registers (static) have been read this session. */
  private readonly _meterProductRead = new Set<number>();

  constructor(options: PollManagerOptions) {
    super();
    // Use ?? per-field so explicit `undefined` values don't override defaults
    this.options = {
      host: options.host,
      port: options.port ?? 8899,
      pollIntervalMs: options.pollIntervalMs ?? 15_000,
      fullRefreshIntervalMs: options.fullRefreshIntervalMs ?? 60_000,
      autoReconnect: options.autoReconnect ?? true,
      reconnectBackoffMs: options.reconnectBackoffMs ?? 5_000,
      reconnectMaxBackoffMs: options.reconnectMaxBackoffMs ?? 300_000,
    };
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
    this.client = new Client({
      host: this.options.host,
      port: this.options.port,
      timeout: this.timing.requestTimeoutMs,
      retries: this.timing.requestRetries,
      onDebug: (msg) => this.emit('debug', msg),
      // Store ALL register data the inverter sends, whether or not it matches a pending
      // request. GivEnergy inverters enter "push mode" after receiving requests and
      // spontaneously send register data in 60-register chunks, and the dongle relays its own
      // cloud polls to every client. GivTCP's consumer does the same: plant.update(message)
      // for every response. Matched responses arrive here too, so this is the one place
      // registers enter the caches.
      onRegisterData: (slave, fc, base, values) => this._store(slave, fc, base, values),
    });
  }

  getData(): InverterSnapshot {
    if (!this._started || !this._cache) {
      throw new Error('not started');
    }
    return this._cache;
  }

  /**
   * Connect and run the first full poll. Rejects with `UnsupportedDeviceError` (after closing the
   * connection) when the device is a plant controller or an unknown device type.
   */
  async start(): Promise<void> {
    this.emit('debug', `connecting to ${this.options.host}:${this.options.port}`);
    await this.client.connect();
    this.emit('debug', 'connected');
    this._started = true;
    await this._executePoll(true);
    if (this._unsupported) {
      const error = this._unsupported;
      await this.stop();
      throw error;
    }
    this._pollTimer = setInterval(() => this._executePoll(false), this.options.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this._reconnectAbort = true;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    await this.client.close();
    this._started = false;
    this._reconnecting = false;
  }

  /** The resolved model. Throws before the first snapshot. */
  get model(): SinglePhaseModel | ThreePhaseModel {
    return this._requireContext().model;
  }

  get layout(): Layout {
    return this._requireContext().layout;
  }

  /** The capabilities the snapshot is built with: resolved from the model and firmware, minus runtime downgrades. */
  get capabilities(): Capabilities {
    return this._requireContext().capabilities;
  }

  /** ARM firmware version: HR 21 on single-phase, IR 1327 on three-phase. */
  get armFirmwareVersion(): number {
    return this._requireContext().armFirmwareVersion;
  }

  private _requireContext(): BuildContext {
    const context = this._context();
    if (!this._started || !context || !this._cache) throw new Error('not started');
    return context;
  }

  /**
   * Write one holding register on the inverter (function 6), as 2.x did: the request is retried
   * on timeout and resolves when the inverter echoes it. Rejects on timeout or a matched error
   * reply. Doesn't touch the caches; call `applyWrites` once it resolves.
   */
  async writeHoldingRegister(register: number, value: number): Promise<void> {
    const frame = encodeWriteHoldingRegisterRequest({
      dataAdapterSerial: this.client.dataAdapterSerial,
      slaveAddress: INVERTER_SLAVE,
      register,
      value,
    });
    this.emit('debug', `writing HR ${register} = ${value}`);
    await this.client.sendRequest(frame);
  }

  /**
   * Record holding register writes the inverter accepted: update the cached registers and
   * rebuild the snapshot once from the caches, without a network read. Emits one `data` event.
   */
  applyWrites(writes: ReadonlyArray<readonly [register: number, raw: number]>): void {
    const context = this._context();
    if (!this._started || !context) throw new Error('not started');
    if (writes.length === 0) return;
    for (const [register, raw] of writes) this._inverter().holding.set(register, raw);
    const snapshot = buildSnapshot(this._registerCaches(), context);
    if (!snapshot) {
      // Only a corrupt sanity register (HR 30/33/34) could fail the check after a good poll.
      const registers = writes.map(([register]) => register).join(', ');
      this.emit('debug', `snapshot rebuild after writing HR ${registers} failed the sanity check; keeping the last one`);
      return;
    }
    this._previousSnapshot = snapshot;
    this._cache = snapshot;
    this.emit('data', snapshot);
  }

  /** `applyWrites` for one register. */
  applyWrite(register: number, raw: number): void {
    this.applyWrites([[register, raw]]);
  }

  // ── Register store ─────────────────────────────────────────────────────────

  private _deviceRegisters(slave: number): DeviceRegisters {
    let device = this._devices.get(slave);
    if (!device) {
      device = { holding: new Map(), input: new Map(), product: new Map() };
      this._devices.set(slave, device);
    }
    return device;
  }

  private _inverter(): DeviceRegisters {
    return this._deviceRegisters(INVERTER_SLAVE);
  }

  private _store(slave: number, fc: number, base: number, values: number[]): void {
    const device = this._deviceRegisters(slave);
    const table = fc === FUNCTION_READ_HOLDING ? device.holding
      : fc === FUNCTION_READ_INPUT ? device.input
      : fc === FUNCTION_READ_METER_PRODUCT ? device.product
      : undefined;
    if (!table) return;
    values.forEach((value, i) => table.set(base + i, value));
    // The table lookup above admits only the three read function codes.
    const range: ReceivedRange = { slave, functionCode: fc as ReadRequest['functionCode'], base, count: values.length };
    this._receivedThisPoll.push(range);
    for (const waiting of this._waiting) if (coversAll(range, waiting.request)) waiting.answer();
    this.emit('debug', `stored register data: slave=0x${slave.toString(16)} fc=${fc} base=${base} count=${values.length}`);
  }

  /** The register caches the snapshot builders read, assembled from the store. */
  private _registerCaches(): RegisterCaches {
    const inverter = this._inverter();
    const answered = (slave: number) => {
      const device = this._devices.get(slave);
      return device && device.input.size > 0 ? device : undefined;
    };

    const batteryModules = LOW_VOLTAGE_BATTERY_SLAVES.flatMap((slave) => answered(slave)?.input ?? []);

    const batteryStacks: BatteryStackCaches[] = [];
    for (let index = 0; index < MAX_BATTERY_STACKS; index++) {
      const controlUnit = answered(BATTERY_CONTROL_UNIT_BASE_SLAVE + index);
      if (!controlUnit) continue;
      const offset = BATTERY_MODULE_STACK_OFFSET * index;
      const modules: BatteryStackCaches['modules'] = [];
      for (let module = 0; module < MAX_BATTERY_MODULES; module++) {
        const device = answered(BATTERY_MODULE_BASE_SLAVE + module);
        if (!device?.input.has(DEVICE_REGISTER_START + offset)) continue;
        // Stack n's modules answer at IR 60 + 120 × n; the builders read them from IR 60.
        const input = new Map<number, number>();
        for (let i = 0; i < DEVICE_REGISTER_COUNT; i++) {
          const value = device.input.get(DEVICE_REGISTER_START + offset + i);
          if (value !== undefined) input.set(DEVICE_REGISTER_START + i, value);
        }
        modules.push({ index: module, input });
      }
      batteryStacks.push({ index, controlUnit: controlUnit.input, modules });
    }

    const meters: MeterCaches[] = METER_SLAVES.flatMap((slaveAddress) => {
      const device = answered(slaveAddress);
      return device ? [{ slaveAddress, input: device.input, product: device.product }] : [];
    });

    return { holding: inverter.holding, input: inverter.input, batteryModules, batteryStacks, meters };
  }

  // ── Model, capabilities and context ────────────────────────────────────────

  /**
   * Resolve the model from HR 0 and HR 21. Returns null while HR 0 hasn't been read, or while the
   * HR 0 block itself looks corrupt.
   *
   * Until a snapshot built with the model passes the sanity check (`_modelConfirmed`), the model
   * is resolved again from each new HR 0 block, so a corrupt first block doesn't stick.
   *
   * Throws `UnsupportedDeviceError` for a plant controller or an unknown device type code, but
   * only from a block whose own sanity registers (HR 30/33/34) look plausible.
   */
  private _identify(): Identified | null {
    if (this._modelConfirmed) return this._identified;
    const holding = this._inverter().holding;
    const deviceTypeCode = holding.get(0);
    if (deviceTypeCode === undefined) return null;
    if (!holdingBlockLooksSane(holding)) {
      this.emit('debug', 'HR 0 block fails its sanity registers; not resolving the model from it');
      this._identified = null;
      return null;
    }
    const model = resolveModel(deviceTypeCode, holding.get(21) ?? 0);
    if (model === 'unknown' || isPlantController(model)) throw new UnsupportedDeviceError(model, deviceTypeCode);
    if (this._identified?.model !== model) {
      // layoutOf decides the layout from the model, so the pair is consistent.
      this._identified = { model, layout: layoutOf(model) } as Identified;
      this.emit('debug', `identified ${model} (${this._identified.layout}, device type code 0x${deviceTypeCode.toString(16)})`);
    }
    return this._identified;
  }

  private _unansweredHoldingBases(): Set<number> {
    const bases = new Set<number>();
    for (const key of this._unanswered) {
      const [slave, functionCode, base] = key.split(':').map(Number);
      if (slave === INVERTER_SLAVE && functionCode === FUNCTION_READ_HOLDING) bases.add(base);
    }
    return bases;
  }

  /**
   * The build context: the resolved model with capabilities from the current ARM firmware,
   * minus the blocks the inverter never answered. Null until the model is resolved.
   */
  private _context(): BuildContext | null {
    const identified = this._identified;
    if (!identified) return null;
    const { holding, input } = this._inverter();
    const armFirmwareVersion = armFirmwareVersionOf({ holding, input }, identified.layout) ?? 0;
    const capabilities = effectiveCapabilities(
      capabilitiesFor(identified.model, armFirmwareVersion),
      this._unansweredHoldingBases(),
    );
    return { ...identified, capabilities, armFirmwareVersion, previous: this._previousSnapshot };
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  private _encode(request: ReadRequest): Buffer {
    const encode = request.functionCode === FUNCTION_READ_HOLDING ? encodeReadHoldingRegistersRequest
      : request.functionCode === FUNCTION_READ_INPUT ? encodeReadInputRegistersRequest
      : encodeReadMeterProductRegistersRequest;
    return encode({
      dataAdapterSerial: this.client.dataAdapterSerial,
      slaveAddress: request.slave,
      baseRegister: request.base,
      registerCount: request.count,
    });
  }

  /** Whether data covering every register of `request` arrived this poll. */
  private _filledThisPoll(request: ReadRequest): boolean {
    return this._receivedThisPoll.some((range) => coversAll(range, request));
  }

  /**
   * Whether data covering the start of `request` arrived this poll: its matched reply, a late
   * reply, or a larger block (the dongle relays its cloud polls in other shapes).
   */
  private _answeredThisPoll(request: ReadRequest): boolean {
    return this._receivedThisPoll.some((range) => coversStart(range, request));
  }

  /**
   * Request registers and resolve `true` once data covering them arrives, or `false` after
   * `retries` retries of a timed-out attempt.
   *
   * Quirks this works around (see dumps of a Gen3 on push mode):
   * - The inverter doesn't answer a request for a block it has just pushed, so a block already
   *   filled by push data this poll isn't requested at all.
   * - Replies often arrive just after an attempt timed out, when the client no longer has a
   *   pending request for them. Any data covering the request counts while it is outstanding,
   *   including between attempts, so a late reply ends the request instead of a further retry.
   */
  private async _request(request: ReadRequest, retries: number): Promise<boolean> {
    const label = requestLabel(request);
    if (this._filledThisPoll(request)) {
      this.emit('debug', `${label} filled from push data; not requesting it`);
      return true;
    }
    let answered = false;
    let answer!: () => void;
    const covered = new Promise<true>((resolve) => {
      answer = () => { answered = true; resolve(true); };
    });
    const waiting = { request, answer };
    this._waiting.add(waiting);
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
          await this._delay(this.timing.retryDelayMs);
          if (answered) break;
          this.emit('debug', `retry ${attempt}/${retries} for ${label}`);
        } else {
          this.emit('debug', `reading ${label}`);
        }
        // The client's own retries are off: this loop retries, so it can stop on a late reply.
        const reply = this.client.sendRequest(this._encode(request), { retries: 0 }).then(() => true as const, (err: unknown) => err);
        const outcome = await Promise.race([reply, covered]);
        if (outcome === true) break;
        const message = outcome instanceof Error ? outcome.message : String(outcome);
        if (!/timeout/.test(message)) {
          this.emit('debug', `${label} failed: ${message}`);
          return false;
        }
        this.emit('debug', `${label} attempt ${attempt} timed out`);
      }
    } finally {
      this._waiting.delete(waiting);
    }
    this.emit('debug', answered || this._filledThisPoll(request) ? `${label} ok` : `${label} unanswered`);
    return answered || this._filledThisPoll(request);
  }

  /**
   * Count the reads that weren't answered this poll, and stop requesting one once it misses
   * `UNANSWERED_AFTER_MISSES` live polls in a row. Only called for a live poll, so a dead link
   * doesn't mark every read unanswered. `essential` reads (the sanity registers' blocks) are
   * never dropped: without them no snapshot can be built.
   */
  private _recordMisses(requested: readonly ReadRequest[], essential: ReadonlySet<string> = new Set()): void {
    const before = this._context()?.capabilities;
    for (const request of requested) {
      const key = requestKey(request);
      if (this._answeredThisPoll(request)) {
        this._misses.delete(key);
        continue;
      }
      if (essential.has(key)) continue;
      const misses = (this._misses.get(key) ?? 0) + 1;
      this._misses.set(key, misses);
      if (misses >= UNANSWERED_AFTER_MISSES) {
        this._unanswered.add(key);
        this._misses.delete(key);
        this.emit('debug', `${requestLabel(request)} unanswered ${misses} polls in a row; no longer requesting it`);
      }
    }
    const after = this._context()?.capabilities;
    if (before && after) {
      const lost = (Object.keys(before) as (keyof typeof before)[]).filter((flag) => before[flag] && !after[flag]);
      if (lost.length > 0) this.emit('debug', `capabilities turned off: ${lost.join(', ')}`);
    }
  }

  /**
   * Request each read not yet dropped as unanswered, one after another, and return the ones
   * requested (for `_recordMisses`).
   */
  private async _requestEach(requests: readonly ReadRequest[], retries: number): Promise<ReadRequest[]> {
    const requested = requests.filter((request) => !this._unanswered.has(requestKey(request)));
    for (const request of requested) {
      await this._request(request, retries);
      await this._delay(this.timing.interReadDelayMs);
    }
    return requested;
  }

  private async _executePoll(fullRefresh = false): Promise<void> {
    if (this._polling) return;
    this._polling = true;
    this._receivedThisPoll = [];
    const now = Date.now();
    const doFull = fullRefresh || (now - this._lastFullRefresh >= this.options.fullRefreshIntervalMs);

    try {
      // Reads are SEQUENTIAL with an inter-frame delay, matching GivTCP's serial producer
      // queue. Each request retries on timeout independently, and push data fills the
      // caches whether or not the matched response arrives.
      const requested: ReadRequest[] = [];
      const read = async (type: RegisterType, registerBlock: RegisterBlock) => {
        requested.push(...await this._requestEach([inverterRead(type, registerBlock)], this.timing.requestRetries));
      };

      // HR 0 first: it identifies the model, which decides every other block.
      await read('holding', { base: 0, count: 60 });
      let identified = this._identify();
      if (identified) {
        for (const registerBlock of inputBlocksFor(identified.layout, doFull)) await read('input', registerBlock);
        // Capabilities need the ARM firmware, which three-phase keeps in IR 1327.
        const capabilities = this._context()!.capabilities;
        for (const registerBlock of holdingBlocksFor(identified.layout, capabilities, doFull)) {
          if (registerBlock.base !== 0) await read('holding', registerBlock);
        }
      }

      // Wait for push data to settle. After our requests the inverter enters push mode and
      // sends register data in 60-register chunks; this lets it arrive and fill the caches.
      this.emit('debug', `waiting ${this.timing.pushSoakMs}ms for remaining push data...`);
      await this._delay(this.timing.pushSoakMs);

      // A poll where the inverter sent nothing — no matched response and no push data — means
      // the transport is dead, even though a stale snapshot could still be built from the
      // caches. Count it as a failed poll so _failCount climbs toward the reconnect threshold.
      if (!this._receivedThisPoll.some((range) => range.slave === INVERTER_SLAVE)) {
        this.emit('debug', 'no live response from inverter this cycle — treating poll as failed');
        this._handlePollResult(null, new Error('no response from inverter'));
        return;
      }

      // HR 0 may have arrived (or changed) as push data during the soak.
      identified = this._identify();
      if (!identified) {
        this._handlePollResult(null, new Error('inverter not identified yet (HR 0 not read)'));
        return;
      }
      const sanityInputBlock = identified.layout === 'three_phase' ? 1120 : 0;
      this._recordMisses(requested, new Set([
        requestKey(inverterRead('holding', { base: 0, count: 60 })),
        requestKey(inverterRead('input', { base: sanityInputBlock, count: 60 })),
      ]));

      if (doFull) {
        const capabilities = this._context()!.capabilities;
        if (capabilities.highVoltageBattery) await this._scanHighVoltageBatteries();
        else await this._scanLowVoltageBatteries();
        await this._scanMeters();
        this._lastFullRefresh = now;
      }

      const snapshot = buildSnapshot(this._registerCaches(), this._context()!);
      if (snapshot && !this._modelConfirmed) {
        this._modelConfirmed = true;
        this.emit('debug', `model confirmed: ${snapshot.model}`);
      }
      this._handlePollResult(snapshot, snapshot ? null : new Error('sanity check failed'));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error instanceof UnsupportedDeviceError) {
        this.emit('debug', error.message);
        this._unsupported = error;
        if (this._pollTimer) {
          clearInterval(this._pollTimer);
          this._pollTimer = null;
        }
        return;
      }
      this.emit('debug', `poll failed: ${error.message}`);
      this._handlePollResult(null, error);
    } finally {
      this._polling = false;
    }
  }

  /**
   * Forget a device's input registers before a scan, so a device that stops answering drops out.
   * Meter product registers are static and read once, so they are kept.
   */
  private _forget(slaves: Iterable<number>): void {
    for (const slave of slaves) this._devices.get(slave)?.input.clear();
  }

  /** Low-voltage battery modules. Slots can be non-contiguous (#6), so every slot is tried. */
  private async _scanLowVoltageBatteries(): Promise<void> {
    this._forget(LOW_VOLTAGE_BATTERY_SLAVES);
    const reads = LOW_VOLTAGE_BATTERY_SLAVES.map((slave): ReadRequest =>
      ({ slave, functionCode: FUNCTION_READ_INPUT, base: DEVICE_REGISTER_START, count: DEVICE_REGISTER_COUNT }));
    this._recordMisses(await this._requestEach(reads, this.timing.scanRetries));
  }

  /**
   * High-voltage battery stacks: the aggregator (0xA0, IR 60–64) gives the number of control
   * units; each control unit (0x70 + n) gives its module count; each module (0x50 + k) is read at
   * IR 60 + 120 × n. An aggregator that doesn't answer three full refreshes in a row is dropped
   * like any other read, which ends the high-voltage scan for the session.
   */
  private async _scanHighVoltageBatteries(): Promise<void> {
    const moduleSlaves = Array.from({ length: MAX_BATTERY_MODULES }, (_, k) => BATTERY_MODULE_BASE_SLAVE + k);
    const controlUnitSlaves = Array.from({ length: MAX_BATTERY_STACKS }, (_, n) => BATTERY_CONTROL_UNIT_BASE_SLAVE + n);
    this._forget([BATTERY_AGGREGATOR_SLAVE, ...controlUnitSlaves, ...moduleSlaves]);
    const input = (slave: number, base: number, count: number): ReadRequest =>
      ({ slave, functionCode: FUNCTION_READ_INPUT, base, count });

    const aggregatorRead = input(BATTERY_AGGREGATOR_SLAVE, DEVICE_REGISTER_START, 5);
    this._recordMisses(await this._requestEach([aggregatorRead], this.timing.scanRetries));
    const aggregator = this._devices.get(BATTERY_AGGREGATOR_SLAVE)?.input;
    const reportedStacks = aggregator?.get(BATTERY_AGGREGATOR_STACK_COUNT_REGISTER);
    if (reportedStacks === undefined) {
      this.emit('debug', 'battery aggregator did not answer; skipping the high-voltage battery scan');
      return;
    }
    const stackCount = Math.min(reportedStacks, MAX_BATTERY_STACKS);
    this.emit('debug', `battery aggregator reports ${stackCount} stack(s)`);

    const controlUnitReads = Array.from({ length: stackCount }, (_, stack) =>
      input(BATTERY_CONTROL_UNIT_BASE_SLAVE + stack, DEVICE_REGISTER_START, DEVICE_REGISTER_COUNT));
    this._recordMisses(await this._requestEach(controlUnitReads, this.timing.scanRetries));

    const moduleReads = controlUnitReads.flatMap((read, stack) => {
      const moduleCount = this._devices.get(read.slave)?.input.get(BATTERY_CONTROL_UNIT_MODULE_COUNT_REGISTER);
      if (moduleCount === undefined) return [];
      this.emit('debug', `battery control unit ${stack} has ${moduleCount} module(s)`);
      return Array.from({ length: Math.min(moduleCount, MAX_BATTERY_MODULES) }, (_, module) =>
        input(BATTERY_MODULE_BASE_SLAVE + module, DEVICE_REGISTER_START + BATTERY_MODULE_STACK_OFFSET * stack, DEVICE_REGISTER_COUNT));
    });
    this._recordMisses(await this._requestEach(moduleReads, this.timing.scanRetries));
  }

  /**
   * CT meters on all 8 addresses; they can be non-contiguous, so every address is tried. Product
   * registers (function 22) are static: read once per session, for meters whose data answered.
   */
  private async _scanMeters(): Promise<void> {
    this._forget(METER_SLAVES);
    const dataReads = METER_SLAVES.map((slave): ReadRequest =>
      ({ slave, functionCode: FUNCTION_READ_INPUT, base: DEVICE_REGISTER_START, count: METER_DATA_REGISTER_COUNT }));
    this._recordMisses(await this._requestEach(dataReads, this.timing.scanRetries));

    const productReads = dataReads
      .filter((read) => this._answeredThisPoll(read) && !this._meterProductRead.has(read.slave))
      .map((read): ReadRequest => ({ ...read, functionCode: FUNCTION_READ_METER_PRODUCT, count: METER_PRODUCT_REGISTER_COUNT }));
    const requested = await this._requestEach(productReads, this.timing.scanRetries);
    this._recordMisses(requested);
    for (const read of requested) {
      if (this._answeredThisPoll(read)) this._meterProductRead.add(read.slave);
    }
  }

  private _delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  _handlePollResult(snapshot: InverterSnapshot | null, err: Error | null): void {
    if (snapshot) {
      this._failCount = 0;
      this._previousSnapshot = snapshot;
      this._cache = snapshot;
      this.emit('data', snapshot);
    } else {
      this._failCount++;
      if (this._failCount >= 10 && !this._reconnecting) {
        this.emit('lost', err ?? new Error('too many consecutive failures'));
        if (this.options.autoReconnect) {
          if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
          }
          this._reconnectLoop();
        }
      }
    }
  }

  private async _reconnectLoop(): Promise<void> {
    this._reconnecting = true;
    let attempt = 0;
    let backoff = this.options.reconnectBackoffMs;

    while (!this._reconnectAbort) {
      attempt++;
      this.emit('reconnecting', attempt, backoff);
      this.emit('debug', `reconnect attempt ${attempt}, waiting ${backoff}ms`);

      await this._delay(backoff);
      if (this._reconnectAbort) break;

      try {
        await this.client.close();
        await this.client.connect();
        // Try a full poll to confirm the connection works
        await this._executePoll(true);

        if (this._cache && this._failCount === 0) {
          this.emit('debug', 'reconnected successfully');
          this.emit('reconnected');
          this._reconnecting = false;
          this._failCount = 0;
          this._pollTimer = setInterval(
            () => this._executePoll(false),
            this.options.pollIntervalMs,
          );
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit('debug', `reconnect attempt ${attempt} failed: ${msg}`);
      }

      backoff = Math.min(backoff * 2, this.options.reconnectMaxBackoffMs);
    }

    this._reconnecting = false;
  }
}
