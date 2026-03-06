# Control API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor GivEnergyInverter into a generation-aware class hierarchy with discriminated union snapshots and a complete control API matching giv_tcp functionality.

**Architecture:** Abstract `GivEnergyInverter` base class with `Gen2Inverter`, `Gen3Inverter`, and `ThreePhaseInverter` subclasses. Static `connect()` factory detects generation from serial prefix. Snapshots use discriminated unions keyed on `generation` field so timeslot types vary per generation.

**Tech Stack:** TypeScript, Vitest, Node.js net module

---

### Task 1: Generation type and detection utility

**Files:**
- Create: `src/generation.ts`
- Test: `test/generation.test.ts`

**Step 1: Write the failing test**

```ts
// test/generation.test.ts
import { describe, it, expect } from 'vitest';
import { detectGeneration, type InverterGeneration } from '../src/generation.js';

describe('detectGeneration', () => {
  it('detects CE prefix as gen2', () => {
    expect(detectGeneration('CE1234G567')).toBe('gen2');
  });

  it('detects EE prefix as gen3', () => {
    expect(detectGeneration('EE1234G567')).toBe('gen3');
  });

  it('detects SA prefix as three_phase', () => {
    expect(detectGeneration('SA1234B567')).toBe('three_phase');
  });

  it('returns gen2 for unknown prefix as safe default', () => {
    expect(detectGeneration('XX1234G567')).toBe('gen2');
  });

  it('returns gen2 for empty string', () => {
    expect(detectGeneration('')).toBe('gen2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/generation.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```ts
// src/generation.ts
export type InverterGeneration = 'gen2' | 'gen3' | 'three_phase';

const PREFIX_MAP: Record<string, InverterGeneration> = {
  CE: 'gen2',
  EE: 'gen3',
  SA: 'three_phase',
};

export function detectGeneration(serialNumber: string): InverterGeneration {
  const prefix = serialNumber.slice(0, 2);
  return PREFIX_MAP[prefix] ?? 'gen2';
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/generation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/generation.ts test/generation.test.ts
git commit -m "feat: add inverter generation detection from serial prefix"
```

---

### Task 2: Generation-aware snapshot types

Refactor `InverterSnapshot` into a discriminated union. Gen3 timeslots include `targetStateOfCharge`; Gen2 and 3ph timeslots do not.

**Files:**
- Modify: `src/model/register-types.ts`
- Modify: `src/model/inverter-snapshot.ts`

**Step 1: Update register-types.ts**

`TimeSlot` (no SOC) stays as-is. `TimeSlotConfig` (with SOC) stays for Gen3. Add a `Gen3TimeSlotConfig` alias or keep `TimeSlotConfig` as the Gen3 variant. The key change: `TimeSlot` is the base (start/end only), `TimeSlotConfig` extends it with SOC for Gen3.

Current `TimeSlot` already has just `start`/`end`. Current `TimeSlotConfig` extends it with `targetStateOfCharge`. This is already the right shape — `TimeSlot` for gen2/3ph, `TimeSlotConfig` for gen3.

```ts
// src/model/register-types.ts — no changes needed to TimeSlot/TimeSlotConfig
// They already have the right shape:
//   TimeSlot = { start, end }
//   TimeSlotConfig extends TimeSlot = { start, end, targetStateOfCharge }
```

**Step 2: Refactor inverter-snapshot.ts to discriminated union**

```ts
// src/model/inverter-snapshot.ts
import type { TimeSlot, TimeSlotConfig } from './register-types.js';
import type { BatterySnapshot } from './battery-snapshot.js';
import type { PowerFlows } from '../power-flow.js';

/** Fields shared by all inverter generations */
interface BaseSnapshot {
  serialNumber: string;
  modelCode: number;
  solarPower: number;
  batteryPower: number;
  gridPower: number;
  loadPower: number;
  stateOfCharge: number;
  batteryVoltage: number;
  batteryCurrent: number;
  gridVoltage: number;
  gridFrequency: number;
  inverterHeatsinkTemp: number;
  pvEnergyTotalKwh: number;
  batteryChargeEnergyTotalKwh: number;
  batteryDischargeEnergyTotalKwh: number;
  gridImportEnergyTotalKwh: number;
  gridExportEnergyTotalKwh: number;
  enableCharge: boolean;
  enableDischarge: boolean;
  chargeTargetStateOfCharge: number;
  systemTime: Date;
  powerFlows: PowerFlows;
  batteries: BatterySnapshot[];
}

export interface Gen2Snapshot extends BaseSnapshot {
  generation: 'gen2';
  chargeSlots: TimeSlot[];
  dischargeSlots: TimeSlot[];
}

export interface Gen3Snapshot extends BaseSnapshot {
  generation: 'gen3';
  chargeSlots: TimeSlotConfig[];
  dischargeSlots: TimeSlotConfig[];
}

export interface ThreePhaseSnapshot extends BaseSnapshot {
  generation: 'three_phase';
  chargeSlots: TimeSlot[];
  dischargeSlots: TimeSlot[];
}

export type InverterSnapshot = Gen2Snapshot | Gen3Snapshot | ThreePhaseSnapshot;
```

**Step 3: Run all tests to see what breaks**

Run: `npx vitest run`
Expected: Some tests may fail because `buildSnapshot` doesn't produce the `generation` field yet. Fix in Task 3.

**Step 4: Commit**

```bash
git add src/model/inverter-snapshot.ts src/model/register-types.ts
git commit -m "refactor: make InverterSnapshot a discriminated union by generation"
```

---

### Task 3: Update snapshot builder for generation-aware output

The snapshot builder needs to accept the generation and produce the right snapshot type. Gen2/3ph snapshots have `TimeSlot[]` (no SOC), Gen3 has `TimeSlotConfig[]` (with SOC).

**Files:**
- Modify: `src/snapshot-builder.ts`
- Modify: `test/snapshot-builder.test.ts`

**Step 1: Update snapshot builder**

Add `generation` to `SnapshotBuilderOptions`. The builder uses it to:
1. Set the `generation` discriminant field
2. Choose how many timeslots to read (1 for gen2, 2 for 3ph, 10 for gen3)
3. Include/exclude `targetStateOfCharge` in timeslot objects

```ts
// In SnapshotBuilderOptions, add:
generation?: InverterGeneration; // default 'gen3' for backwards compat
```

In the timeslot building section:
- Gen3: map all 10 `CHARGE_SLOT_REGISTERS` → `TimeSlotConfig[]` (with SOC)
- Gen2: map only slot 1 of `CHARGE_SLOT_REGISTERS` → `TimeSlot[]` (no SOC field)
- 3ph: use 3ph-specific registers (HR 1113-1116, 1118-1121) → `TimeSlot[]`, 2 slots

Need to add 3ph timeslot register constants to `timeslot-registers.ts`.

**Step 2: Update timeslot-registers.ts for 3ph**

```ts
// Add to src/timeslot-registers.ts:

/** Three-phase charge slot registers (2 slots only) */
export const THREE_PHASE_CHARGE_SLOT_REGISTERS: TimeslotRegisters[] = [
  { start: 1113, end: 1114, targetStateOfCharge: 1111 }, // Slot 1 (SOC target is global)
  { start: 1115, end: 1116, targetStateOfCharge: 1111 }, // Slot 2 (same global SOC)
];

/** Three-phase discharge slot registers (2 slots only) */
export const THREE_PHASE_DISCHARGE_SLOT_REGISTERS: TimeslotRegisters[] = [
  { start: 1118, end: 1119, targetStateOfCharge: 0 }, // Slot 1 (no per-slot SOC)
  { start: 1120, end: 1121, targetStateOfCharge: 0 }, // Slot 2
];
```

**Step 3: Update snapshot builder to branch on generation**

The key change in `buildSnapshot`:

```ts
// Timeslot building — generation-specific
import { detectGeneration, type InverterGeneration } from './generation.js';

// In buildSnapshot, after identity section:
const generation = options.generation ?? detectGeneration(serialNumber);

// Timeslots:
let chargeSlots: TimeSlot[] | TimeSlotConfig[];
let dischargeSlots: TimeSlot[] | TimeSlotConfig[];

if (generation === 'gen3') {
  chargeSlots = CHARGE_SLOT_REGISTERS.map(reg => ({
    ...toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end)),
    targetStateOfCharge: getHR(cache, reg.targetStateOfCharge),
  }));
  dischargeSlots = DISCHARGE_SLOT_REGISTERS.map(reg => ({
    ...toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end)),
    targetStateOfCharge: getHR(cache, reg.targetStateOfCharge),
  }));
} else if (generation === 'three_phase') {
  chargeSlots = THREE_PHASE_CHARGE_SLOT_REGISTERS.map(reg =>
    toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end))
  );
  dischargeSlots = THREE_PHASE_DISCHARGE_SLOT_REGISTERS.map(reg =>
    toTimeslot(getHR(cache, reg.start), getHR(cache, reg.end))
  );
} else {
  // Gen2: slot 1 only for charge, slots 1-2 for discharge
  chargeSlots = [toTimeslot(getHR(cache, 94), getHR(cache, 95))];
  dischargeSlots = [
    toTimeslot(getHR(cache, 56), getHR(cache, 57)),
    toTimeslot(getHR(cache, 44), getHR(cache, 45)),
  ];
}
```

Return object includes `generation` field and the typed slots. Use `as` cast for the discriminated union since TS can't infer the conditional types easily.

**Step 4: Update tests**

Update `test/snapshot-builder.test.ts`:
- Existing tests need `generation` field checks
- The "reads all 10 charge and discharge slots" test should specify `generation: 'gen3'`
- Add tests for gen2 snapshot (1 charge slot, 2 discharge slots, no SOC)
- Add tests for 3ph snapshot (2 charge, 2 discharge, no SOC)
- Add test that `generation` field is set correctly

```ts
it('sets generation field from serial prefix', () => {
  const cache = makeValidCache(); // uses SA prefix
  const snapshot = buildSnapshot(cache);
  expect(snapshot!.generation).toBe('three_phase');
});

it('builds gen2 snapshot with 1 charge slot and no SOC target', () => {
  const cache = makeValidCache();
  // Change serial to CE prefix
  const serial = 'CE1234G567';
  for (let i = 0; i < 5; i++) {
    cache.holdingRegisters.set(13 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }
  const snapshot = buildSnapshot(cache);
  expect(snapshot!.generation).toBe('gen2');
  expect(snapshot!.chargeSlots).toHaveLength(1);
  expect(snapshot!.dischargeSlots).toHaveLength(2);
  // Gen2 slots should NOT have targetStateOfCharge property
  expect('targetStateOfCharge' in snapshot!.chargeSlots[0]).toBe(false);
});

it('builds gen3 snapshot with 10 charge slots and SOC targets', () => {
  const cache = makeValidCache();
  const serial = 'EE1234G567';
  for (let i = 0; i < 5; i++) {
    cache.holdingRegisters.set(13 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }
  const snapshot = buildSnapshot(cache);
  expect(snapshot!.generation).toBe('gen3');
  expect(snapshot!.chargeSlots).toHaveLength(10);
  expect(snapshot!.chargeSlots[0]).toHaveProperty('targetStateOfCharge');
});
```

**Step 5: Update mock snapshot in poll-manager.test.ts**

Add `generation: 'gen3'` to the `mockSnapshot` object and update `chargeSlots`/`dischargeSlots` to match `TimeSlotConfig` shape (they already have `targetStateOfCharge`).

**Step 6: Run all tests**

Run: `npx vitest run`
Expected: All pass

**Step 7: Commit**

```bash
git add src/timeslot-registers.ts src/snapshot-builder.ts src/model/inverter-snapshot.ts test/snapshot-builder.test.ts test/poll-manager.test.ts
git commit -m "feat: generation-aware snapshots with discriminated union types"
```

---

### Task 4: Refactor GivEnergyInverter into abstract base class

Extract the base class, move current implementation to be shared infrastructure. The subclasses will override specific methods.

**Files:**
- Modify: `src/inverter.ts`
- Create: `src/inverters/gen2.ts`
- Create: `src/inverters/gen3.ts`
- Create: `src/inverters/three-phase.ts`
- Modify: `src/index.ts`
- Modify: `test/integration.test.ts`

**Step 1: Refactor inverter.ts into abstract base**

Key changes to `src/inverter.ts`:
- Make `GivEnergyInverter` abstract
- Remove `constructor` that takes options — replace with protected constructor that takes a `PollManager`
- Add static `connect()` factory method
- Rename `setTargetStateOfCharge` → `setChargeTarget`
- Rename `setEnableCharge` → `setChargeScheduleEnabled`
- Rename `setEnableDischarge` → `setDischargeScheduleEnabled`
- Make `setChargeSlot`, `setDischargeSlot`, `setChargeScheduleEnabled`, `setDischargeScheduleEnabled`, `setChargeTarget` abstract or with default implementations that subclasses can override
- Add new method stubs: `setChargeSlots`, `setDischargeSlots`, `setChargeRate`, `setChargeRatePercent`, `setDischargeRate`, `setDischargeRatePercent`, `setBatteryReserve`, `setBatteryPowerReserve`, `setDateTime`, `syncDateTime`, `reboot`
- Expose `writeRegister` as protected (not private) so subclasses can use it

```ts
// src/inverter.ts
import { EventEmitter } from 'events';
import { PollManager, type PollManagerOptions } from './poll-manager.js';
import { encodeWriteHoldingRegisterRequest } from './pdu/encode.js';
import { detectGeneration, type InverterGeneration } from './generation.js';
import type { InverterSnapshot } from './model/inverter-snapshot.js';

export interface GivEnergyInverterOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;
}

export type InverterMode = 'eco' | 'timed_demand' | 'timed_export';

export interface TimeSlotInput {
  start: string;
  end: string;
  targetStateOfCharge?: number;
}

export abstract class GivEnergyInverter extends EventEmitter {
  protected readonly pollManager: PollManager;

  protected constructor(pollManager: PollManager) {
    super();
    this.pollManager = pollManager;
    this.pollManager.on('data', (snapshot: InverterSnapshot) => this.emit('data', snapshot));
    this.pollManager.on('lost', (err: Error) => this.emit('lost', err));
    this.pollManager.on('debug', (msg: string) => this.emit('debug', msg));
  }

  static async connect(options: GivEnergyInverterOptions): Promise<GivEnergyInverter> {
    const pollManager = new PollManager({
      host: options.host,
      port: options.port,
      pollIntervalMs: options.pollIntervalMs,
    });
    await pollManager.start();
    const snapshot = pollManager.getData();
    const generation = detectGeneration(snapshot.serialNumber);

    // Import subclasses lazily to avoid circular deps
    let inverter: GivEnergyInverter;
    switch (generation) {
      case 'gen3': {
        const { Gen3Inverter } = await import('./inverters/gen3.js');
        inverter = new Gen3Inverter(pollManager);
        break;
      }
      case 'three_phase': {
        const { ThreePhaseInverter } = await import('./inverters/three-phase.js');
        inverter = new ThreePhaseInverter(pollManager);
        break;
      }
      default: {
        const { Gen2Inverter } = await import('./inverters/gen2.js');
        inverter = new Gen2Inverter(pollManager);
        break;
      }
    }
    return inverter;
  }

  getData(): InverterSnapshot {
    return this.pollManager.getData();
  }

  async stop(): Promise<void> {
    return this.pollManager.stop();
  }

  // ── Shared control methods ──────────────────────────────────

  async setMode(mode: InverterMode): Promise<void> {
    // Eco: ECO_MODE=1, ENABLE_DISCHARGE=0
    // Timed Demand: ECO_MODE=1, ENABLE_DISCHARGE=1
    // Timed Export: ECO_MODE=0, ENABLE_DISCHARGE=1
    switch (mode) {
      case 'eco':
        await this.writeRegister(27, 1);
        await this.writeRegister(59, 0);
        break;
      case 'timed_demand':
        await this.writeRegister(27, 1);
        await this.writeRegister(59, 1);
        break;
      case 'timed_export':
        await this.writeRegister(27, 0);
        await this.writeRegister(59, 1);
        break;
    }
  }

  async setDateTime(date: Date): Promise<void> {
    await this.writeRegister(35, date.getFullYear() - 2000);
    await this.writeRegister(36, date.getMonth() + 1);
    await this.writeRegister(37, date.getDate());
    await this.writeRegister(38, date.getHours());
    await this.writeRegister(39, date.getMinutes());
    await this.writeRegister(40, date.getSeconds());
  }

  async syncDateTime(): Promise<void> {
    await this.setDateTime(new Date());
  }

  async reboot(): Promise<void> {
    await this.writeRegister(163, 100);
  }

  async unsafe_writeRegister(register: number, value: number): Promise<void> {
    return this.writeRegister(register, value);
  }

  // ── Abstract methods (generation-specific) ──────────────────

  abstract setChargeScheduleEnabled(enabled: boolean): Promise<void>;
  abstract setDischargeScheduleEnabled(enabled: boolean): Promise<void>;
  abstract setChargeTarget(percent: number): Promise<void>;
  abstract setChargeSlot(slot: number, config: TimeSlotInput): Promise<void>;
  abstract setChargeSlots(configs: TimeSlotInput[]): Promise<void>;
  abstract setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void>;
  abstract setDischargeSlots(configs: TimeSlotInput[]): Promise<void>;
  abstract setChargeRate(watts: number): Promise<void>;
  abstract setChargeRatePercent(percent: number): Promise<void>;
  abstract setDischargeRate(watts: number): Promise<void>;
  abstract setDischargeRatePercent(percent: number): Promise<void>;
  abstract setBatteryReserve(percent: number): Promise<void>;
  abstract setBatteryPowerReserve(percent: number): Promise<void>;

  // ── Protected helpers ───────────────────────────────────────

  protected async writeRegister(register: number, value: number): Promise<void> {
    const client = (this.pollManager as any).client;
    const frame = encodeWriteHoldingRegisterRequest({
      dataAdapterSerial: (this.pollManager as any).client.dataAdapterSerial ?? '**********',
      slaveAddress: 0x11,
      register,
      value,
    });
    await client.sendRequest(frame);
  }
}

// ── Shared validation helpers ──────────────────────────────────

export function timeToInt(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 100 + m;
}

export function validateTime(time: string): void {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError(`invalid time format "${time}", expected "HH:MM"`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new RangeError(`invalid time "${time}", hour must be 0-23 and minute 0-59`);
}

export function validateStateOfCharge(percent: number): void {
  if (!Number.isInteger(percent) || percent < 4 || percent > 100) {
    throw new RangeError(`state of charge must be an integer 4-100, got ${percent}`);
  }
}

export function validateRatePercent(percent: number): void {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`rate percent must be an integer 0-100, got ${percent}`);
  }
}
```

**Step 2: Create Gen2Inverter subclass**

```ts
// src/inverters/gen2.ts
import {
  GivEnergyInverter,
  type TimeSlotInput,
  validateTime,
  validateStateOfCharge,
  validateRatePercent,
  timeToInt,
} from '../inverter.js';

export class Gen2Inverter extends GivEnergyInverter {
  // Gen2: 1 charge slot, 2 discharge slots
  // Charge rate: HR(111) 0-50%, HR(313) AC rate
  // Discharge rate: HR(112) 0-50%, HR(314) AC rate
  // Battery reserve: HR(110), Power reserve: HR(114)

  async setChargeScheduleEnabled(enabled: boolean): Promise<void> {
    await this.writeRegister(96, enabled ? 1 : 0);
  }

  async setDischargeScheduleEnabled(enabled: boolean): Promise<void> {
    await this.writeRegister(59, enabled ? 1 : 0);
  }

  async setChargeTarget(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(116, percent);
  }

  async setChargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    if (slot !== 1) throw new RangeError(`Gen2 inverter supports charge slot 1 only, got ${slot}`);
    validateTime(config.start);
    validateTime(config.end);
    await this.writeRegister(94, timeToInt(config.start));
    await this.writeRegister(95, timeToInt(config.end));
    // Gen2 ignores targetStateOfCharge silently
  }

  async setChargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 1) throw new RangeError(`Gen2 inverter supports 1 charge slot, got ${configs.length}`);
    if (configs.length === 0) {
      await this.setChargeSlot(1, { start: '00:00', end: '00:00' });
      return;
    }
    await this.setChargeSlot(1, configs[0]);
  }

  async setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    validateTime(config.start);
    validateTime(config.end);
    if (slot === 1) {
      await this.writeRegister(56, timeToInt(config.start));
      await this.writeRegister(57, timeToInt(config.end));
    } else if (slot === 2) {
      await this.writeRegister(44, timeToInt(config.start));
      await this.writeRegister(45, timeToInt(config.end));
    } else {
      throw new RangeError(`Gen2 inverter supports discharge slots 1-2, got ${slot}`);
    }
  }

  async setDischargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 2) throw new RangeError(`Gen2 inverter supports 2 discharge slots, got ${configs.length}`);
    // Zero all slots first
    await this.setDischargeSlot(1, { start: '00:00', end: '00:00' });
    await this.setDischargeSlot(2, { start: '00:00', end: '00:00' });
    for (let i = 0; i < configs.length; i++) {
      await this.setDischargeSlot(i + 1, configs[i]);
    }
  }

  async setChargeRate(watts: number): Promise<void> {
    // HR(111): 0-50 (percentage of rated power, 50 = max)
    const rated = 50; // Gen2 max is 50%
    const percent = Math.round(Math.min(watts / 100, rated)); // rough conversion
    await this.writeRegister(111, Math.max(0, Math.min(percent, 50)));
  }

  async setChargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(313, percent);
  }

  async setDischargeRate(watts: number): Promise<void> {
    const percent = Math.round(Math.min(watts / 100, 50));
    await this.writeRegister(112, Math.max(0, Math.min(percent, 50)));
  }

  async setDischargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(314, percent);
  }

  async setBatteryReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(110, percent);
  }

  async setBatteryPowerReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(114, percent);
  }
}
```

**Step 3: Create Gen3Inverter subclass**

```ts
// src/inverters/gen3.ts
import {
  GivEnergyInverter,
  type TimeSlotInput,
  validateTime,
  validateStateOfCharge,
  validateRatePercent,
  timeToInt,
} from '../inverter.js';
import { CHARGE_SLOT_REGISTERS, DISCHARGE_SLOT_REGISTERS } from '../timeslot-registers.js';

export class Gen3Inverter extends GivEnergyInverter {
  // Gen3: 10 charge slots, 10 discharge slots, per-slot SOC targets
  // Same base registers as Gen2 for rates/reserves

  async setChargeScheduleEnabled(enabled: boolean): Promise<void> {
    await this.writeRegister(96, enabled ? 1 : 0);
  }

  async setDischargeScheduleEnabled(enabled: boolean): Promise<void> {
    await this.writeRegister(59, enabled ? 1 : 0);
  }

  async setChargeTarget(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(116, percent);
  }

  async setChargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    const regs = CHARGE_SLOT_REGISTERS[slot - 1];
    if (!regs) throw new RangeError(`charge slot must be 1-10, got ${slot}`);
    validateTime(config.start);
    validateTime(config.end);
    await this.writeRegister(regs.start, timeToInt(config.start));
    await this.writeRegister(regs.end, timeToInt(config.end));
    if (config.targetStateOfCharge !== undefined) {
      validateStateOfCharge(config.targetStateOfCharge);
      await this.writeRegister(regs.targetStateOfCharge, config.targetStateOfCharge);
    }
  }

  async setChargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 10) throw new RangeError(`Gen3 inverter supports 10 charge slots, got ${configs.length}`);
    for (let i = 0; i < 10; i++) {
      if (i < configs.length) {
        await this.setChargeSlot(i + 1, configs[i]);
      } else {
        await this.setChargeSlot(i + 1, { start: '00:00', end: '00:00', targetStateOfCharge: 0 });
      }
    }
  }

  async setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    const regs = DISCHARGE_SLOT_REGISTERS[slot - 1];
    if (!regs) throw new RangeError(`discharge slot must be 1-10, got ${slot}`);
    validateTime(config.start);
    validateTime(config.end);
    await this.writeRegister(regs.start, timeToInt(config.start));
    await this.writeRegister(regs.end, timeToInt(config.end));
    if (config.targetStateOfCharge !== undefined) {
      validateStateOfCharge(config.targetStateOfCharge);
      await this.writeRegister(regs.targetStateOfCharge, config.targetStateOfCharge);
    }
  }

  async setDischargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 10) throw new RangeError(`Gen3 inverter supports 10 discharge slots, got ${configs.length}`);
    for (let i = 0; i < 10; i++) {
      if (i < configs.length) {
        await this.setDischargeSlot(i + 1, configs[i]);
      } else {
        await this.setDischargeSlot(i + 1, { start: '00:00', end: '00:00', targetStateOfCharge: 0 });
      }
    }
  }

  async setChargeRate(watts: number): Promise<void> {
    const percent = Math.round(Math.min(watts / 100, 50));
    await this.writeRegister(111, Math.max(0, Math.min(percent, 50)));
  }

  async setChargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(313, percent);
  }

  async setDischargeRate(watts: number): Promise<void> {
    const percent = Math.round(Math.min(watts / 100, 50));
    await this.writeRegister(112, Math.max(0, Math.min(percent, 50)));
  }

  async setDischargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(314, percent);
  }

  async setBatteryReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(110, percent);
  }

  async setBatteryPowerReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(114, percent);
  }

  // ── Gen3-only methods ──────────────────────────────────────

  async setExportLimit(watts: number): Promise<void> {
    if (watts < 0 || watts > 65000) throw new RangeError(`export limit must be 0-65000, got ${watts}`);
    await this.writeRegister(2071, watts);
  }

  async setBatteryPauseMode(mode: 'disabled' | 'pause_charge' | 'pause_discharge' | 'pause_both'): Promise<void> {
    const modeMap = { disabled: 0, pause_charge: 1, pause_discharge: 2, pause_both: 3 };
    await this.writeRegister(318, modeMap[mode]);
  }

  async setPauseSlot(config: { start: string; end: string }): Promise<void> {
    validateTime(config.start);
    validateTime(config.end);
    await this.writeRegister(319, timeToInt(config.start));
    await this.writeRegister(320, timeToInt(config.end));
  }
}
```

**Step 4: Create ThreePhaseInverter subclass**

```ts
// src/inverters/three-phase.ts
import {
  GivEnergyInverter,
  type TimeSlotInput,
  validateTime,
  validateStateOfCharge,
  validateRatePercent,
  timeToInt,
} from '../inverter.js';

export class ThreePhaseInverter extends GivEnergyInverter {
  // 3ph: 2 charge slots, 2 discharge slots
  // Charge enable: HR(1123) + HR(1112)
  // Charge rate: HR(1110) 0-100%, Discharge rate: HR(1108) 0-100%
  // Battery reserve: HR(1109), Power reserve: HR(1078)
  // Charge target: HR(1111)

  async setChargeScheduleEnabled(enabled: boolean): Promise<void> {
    const val = enabled ? 1 : 0;
    await this.writeRegister(1123, val); // FORCE_CHARGE_ENABLE
    await this.writeRegister(1112, val); // AC_CHARGE_ENABLE
  }

  async setDischargeScheduleEnabled(enabled: boolean): Promise<void> {
    await this.writeRegister(1122, enabled ? 1 : 0);
  }

  async setChargeTarget(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(1111, percent);
  }

  async setChargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    validateTime(config.start);
    validateTime(config.end);
    if (slot === 1) {
      await this.writeRegister(1113, timeToInt(config.start));
      await this.writeRegister(1114, timeToInt(config.end));
    } else if (slot === 2) {
      await this.writeRegister(1115, timeToInt(config.start));
      await this.writeRegister(1116, timeToInt(config.end));
    } else {
      throw new RangeError(`Three-phase inverter supports charge slots 1-2, got ${slot}`);
    }
    // 3ph ignores targetStateOfCharge silently (global target via setChargeTarget)
  }

  async setChargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 2) throw new RangeError(`Three-phase inverter supports 2 charge slots, got ${configs.length}`);
    await this.setChargeSlot(1, configs[0] ?? { start: '00:00', end: '00:00' });
    await this.setChargeSlot(2, configs[1] ?? { start: '00:00', end: '00:00' });
  }

  async setDischargeSlot(slot: number, config: TimeSlotInput): Promise<void> {
    validateTime(config.start);
    validateTime(config.end);
    if (slot === 1) {
      await this.writeRegister(1118, timeToInt(config.start));
      await this.writeRegister(1119, timeToInt(config.end));
    } else if (slot === 2) {
      await this.writeRegister(1120, timeToInt(config.start));
      await this.writeRegister(1121, timeToInt(config.end));
    } else {
      throw new RangeError(`Three-phase inverter supports discharge slots 1-2, got ${slot}`);
    }
  }

  async setDischargeSlots(configs: TimeSlotInput[]): Promise<void> {
    if (configs.length > 2) throw new RangeError(`Three-phase inverter supports 2 discharge slots, got ${configs.length}`);
    await this.setDischargeSlot(1, configs[0] ?? { start: '00:00', end: '00:00' });
    await this.setDischargeSlot(2, configs[1] ?? { start: '00:00', end: '00:00' });
  }

  async setChargeRate(watts: number): Promise<void> {
    // 3ph uses 0-100% scale on HR(1110)
    const percent = Math.round(Math.min(watts / 50, 100)); // rough — needs rated power
    await this.writeRegister(1110, Math.max(0, Math.min(percent, 100)));
  }

  async setChargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(1110, percent);
  }

  async setDischargeRate(watts: number): Promise<void> {
    const percent = Math.round(Math.min(watts / 50, 100));
    await this.writeRegister(1108, Math.max(0, Math.min(percent, 100)));
  }

  async setDischargeRatePercent(percent: number): Promise<void> {
    validateRatePercent(percent);
    await this.writeRegister(1108, percent);
  }

  async setBatteryReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(1109, percent);
  }

  async setBatteryPowerReserve(percent: number): Promise<void> {
    validateStateOfCharge(percent);
    await this.writeRegister(1078, percent);
  }
}
```

**Step 5: Update index.ts exports**

```ts
// src/index.ts
export { GivEnergyInverter } from './inverter.js';
export type { GivEnergyInverterOptions, InverterMode, TimeSlotInput } from './inverter.js';
export { Gen2Inverter } from './inverters/gen2.js';
export { Gen3Inverter } from './inverters/gen3.js';
export { ThreePhaseInverter } from './inverters/three-phase.js';
export { detectGeneration } from './generation.js';
export type { InverterGeneration } from './generation.js';
export { discover, getLocalSubnet, parseSubnet } from './discover.js';
export type { DiscoveredDevice, DiscoverOptions } from './discover.js';
export type { InverterSnapshot, Gen2Snapshot, Gen3Snapshot, ThreePhaseSnapshot } from './model/inverter-snapshot.js';
export type { BatterySnapshot } from './model/battery-snapshot.js';
export type { TimeSlot, TimeSlotConfig } from './model/register-types.js';
```

**Step 6: Update integration test**

The integration test currently uses `new GivEnergyInverter(...)`. Update to use `GivEnergyInverter.connect(...)` or directly construct a subclass for testing. Since the mock inverter returns serial `SA1234B567`, `connect()` would produce a `ThreePhaseInverter`.

For unit testing the subclasses without a real connection, the test can construct subclasses directly by making the constructor public or using a test helper. Since the constructor takes a `PollManager`, we can mock it.

Update `test/integration.test.ts` to use `GivEnergyInverter.connect()`:

```ts
const inv = await GivEnergyInverter.connect({
  host: '127.0.0.1',
  port: mock.port,
});
```

Remove `await inv.start()` since `connect()` already starts polling.

**Step 7: Run all tests**

Run: `npx vitest run`
Expected: All pass

**Step 8: Commit**

```bash
git add src/inverter.ts src/inverters/ src/index.ts test/integration.test.ts
git commit -m "refactor: split GivEnergyInverter into generation-specific subclasses"
```

---

### Task 5: Add control method tests

Add unit tests for the generation-specific control methods using the mock inverter.

**Files:**
- Create: `test/inverter-controls.test.ts`

**Step 1: Write tests for Gen2 slot limits**

```ts
// test/inverter-controls.test.ts
import { describe, it, expect } from 'vitest';
// Tests use the mock inverter from integration.test.ts pattern
// Test slot validation, rate validation, and register writes

describe('Gen2Inverter controls', () => {
  it('rejects charge slot > 1', async () => {
    // Construct a Gen2Inverter with a mock PollManager
    // Call setChargeSlot(2, ...) and expect RangeError
  });

  it('rejects discharge slot > 2', async () => {
    // Call setDischargeSlot(3, ...) and expect RangeError
  });

  it('ignores targetStateOfCharge silently', async () => {
    // Call setChargeSlot(1, { start: '00:00', end: '04:30', targetStateOfCharge: 80 })
    // Should not throw — just ignores SOC
  });
});

describe('Gen3Inverter controls', () => {
  it('accepts charge slots 1-10', async () => { /* ... */ });
  it('rejects charge slot 11', async () => { /* ... */ });
  it('writes per-slot SOC target', async () => { /* ... */ });
  it('setChargeSlots zeros remaining slots', async () => { /* ... */ });
  it('setExportLimit validates range', async () => { /* ... */ });
  it('setBatteryPauseMode writes correct register values', async () => { /* ... */ });
});

describe('ThreePhaseInverter controls', () => {
  it('rejects charge slot > 2', async () => { /* ... */ });
  it('setChargeScheduleEnabled writes two registers', async () => { /* ... */ });
  it('uses 3ph-specific registers for rates', async () => { /* ... */ });
});

describe('shared controls', () => {
  it('setMode eco sets ECO_MODE=1 ENABLE_DISCHARGE=0', async () => { /* ... */ });
  it('setMode timed_demand sets ECO_MODE=1 ENABLE_DISCHARGE=1', async () => { /* ... */ });
  it('setMode timed_export sets ECO_MODE=0 ENABLE_DISCHARGE=1', async () => { /* ... */ });
  it('setDateTime writes HR 35-40', async () => { /* ... */ });
  it('reboot writes HR(163)=100', async () => { /* ... */ });
  it('validateStateOfCharge rejects < 4', async () => { /* ... */ });
  it('validateStateOfCharge rejects > 100', async () => { /* ... */ });
  it('validateTime rejects invalid format', async () => { /* ... */ });
});
```

The tests need a way to construct subclass instances without a real TCP connection. Options:
1. Mock the `writeRegister` method to record calls
2. Use the mock TCP server from integration.test.ts

Recommended: Extract mock inverter setup to a shared helper, then test each subclass with the mock server, checking `lastWrittenRegister`/`lastWrittenValue`.

**Step 2: Implement tests using mock inverter**

Use the mock server pattern from `test/integration.test.ts`. Each test connects, calls a control method, and checks the mock's `lastWrittenRegister`/`lastWrittenValue`.

**Step 3: Run tests**

Run: `npx vitest run test/inverter-controls.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add test/inverter-controls.test.ts
git commit -m "test: add control method tests for all inverter generations"
```

---

### Task 6: Update poll manager for generation-aware register ranges

The poll manager currently reads the same register ranges for all inverters. 3ph inverters use different ranges (HR 1100+). Gen2 doesn't need HR 240-299.

**Files:**
- Modify: `src/poll-manager.ts`

**Step 1: Make register ranges generation-aware**

After the first poll detects the generation, subsequent polls should read the right ranges. Add generation-specific holding register ranges:

- Gen2: HR 0-59, HR 60-119, HR 180-239
- Gen3: HR 0-59, HR 60-119, HR 180-239, HR 240-299
- 3ph: HR 0-59, HR 60-119, HR 180-239, HR 1080-1139 (contains 1078, 1108-1123)

The generation can be detected after the first poll from the serial in the snapshot.

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All pass

**Step 3: Commit**

```bash
git add src/poll-manager.ts
git commit -m "feat: generation-aware register ranges in poll manager"
```

---

### Task 7: Update snapshot script

Per CLAUDE.md: "Keep the snapshot script up to date to show all data available from the API"

**Files:**
- Modify: `scripts/snapshot.mjs`

**Step 1: Update script to use `connect()` and show generation**

```js
const inverter = await GivEnergyInverter.connect({ host });
const snapshot = inverter.getData();
console.log(`Generation: ${snapshot.generation}`);
// Show generation-specific fields
```

**Step 2: Commit**

```bash
git add scripts/snapshot.mjs
git commit -m "chore: update snapshot script for generation-aware API"
```

---

### Task 8: Final review and cleanup

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Check TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Review exports**

Verify all new types and classes are properly exported from `src/index.ts`.

**Step 4: Update MEMORY.md if needed**

Update auto-memory with new architecture notes.

**Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup for generation-aware control API"
```
