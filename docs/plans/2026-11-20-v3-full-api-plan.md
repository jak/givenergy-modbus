# v3 Full API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Release givenergy-modbus 3.0.0, which exposes every documented register as a typed read value
and every single-register setting as a typed write, gated by inverter model and firmware.

**Architecture:**
- Model resolution and capabilities replace `generation`.
- A declarative settings catalogue (`src/catalogue/`) drives:
  - the snapshot's `settings` group
  - `setSetting` / `unsafe_setSetting`
  - the polled register blocks
- The snapshot builder is split into one module per group under `src/snapshot/`.
- `connect()` returns a `SinglePhaseInverter` or a `ThreePhaseInverter`, discriminated on `layout`.

**Tech Stack:** TypeScript 5.7 (strict, Node16 modules), Node ≥ 22, vitest 3 (including `--typecheck` for
type-level tests), VitePress docs.

**Read first:** `docs/plans/2026-11-19-v3-full-api-design.md` (approved design) and
`docs/plans/2026-11-19-v3-research.md` (register facts; section letters are cited below as R-A … R-F).
`website/register-map.md` is the reference unit's verified register map.

---

## Ground rules (apply to every task)

- **TDD.** Every task: write the failing test → run it and see it fail → implement → see it pass → commit.
- **Tests document quirks** (project CLAUDE.md). When a test pins odd behaviour, its name says why. For
  example: `it('reads HR 319 as the pause start and HR 320 as the end, without the 2.x swap')`.
- **No acronyms in public API names** (project CLAUDE.md). Use `stateOfCharge`, not `soc`, and
  `batteryManagementSystem`, not `bms`, in exported names. Register comments may use the source's names.
- **Commands:**
  - `npm test` (vitest run)
  - `npm run test:types` (added in Task 4)
  - `npm run build` (tsc)
  - `npm run docs` (typedoc + vitepress)
- **Commits:**
  - Conventional commits, with no co-author or Claude attribution (user preference).
  - The first breaking commit uses `feat!:` and a `BREAKING CHANGE:` footer, so release-please cuts 3.0.0.
  - Commit after each task.
- **The real inverter** at 10.29.0.197 is a Gen3, ARM 316.
  - Read-only scripts are allowed. Save their output to `dumps/` and grep that file rather than re-running.
  - **Never write to it** without the user's explicit permission in chat.
  - `dumps/` is gitignored and contains serials, so never commit anything from it except via Task 3's
    redaction.
- **Searching:** in this shell `grep` skips gitignored files. Use `/usr/bin/grep -a` for `dumps/`.
- **Branch:** `feat/v3-full-api`. Don't push or open a PR without asking.

---

## Phase A: Model, capabilities, fixtures

### Task 1: Model resolution

Replaces `src/model/device-types.ts` and `src/generation.ts` (both deleted in Task 18).

**Files:**
- Create: `src/model/models.ts`
- Test: `test/models.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveModel, layoutOf, isPlantController } from '../src/model/models.js';

describe('resolveModel', () => {
  // HR 0 = device type code, HR 21 = ARM firmware (research R-A)
  it.each([
    [0x2001, 316, 'hybrid_gen3'],   // reference unit: century 3
    [0x2001, 302, 'hybrid_gen3'],
    [0x2003, 920, 'hybrid_gen2'],   // century 9
    [0x2003, 820, 'hybrid_gen2'],
    [0x2001, 449, 'hybrid_gen1'],   // Gen1 lines are 1xx, 2xx, 4xx
    [0x2003, 187, 'hybrid_gen1'],
    [0x2101, 0, 'polar'],
    [0x2201, 0, 'hybrid_gen3_plus'],
    [0x2301, 0, 'pv'],
    [0x2401, 0, 'hybrid_gen3'],     // unknown 24xx/25xx: Gen3 layout, no extras
    [0x3001, 282, 'ac'],
    [0x4004, 0, 'hybrid_3ph'],
    [0x4101, 0, 'all_in_one_commercial'],
    [0x5001, 1036, 'ems'],
    [0x6001, 0, 'ac_3ph'],
    [0x7001, 0, 'gateway'],
    [0x8001, 620, 'all_in_one'],
    [0x8102, 295, 'hybrid_hv_gen3'],
    [0x8201, 0, 'all_in_one_hybrid'],
    [0x8301, 0, 'hybrid_gen4'],
  ])('HR0=0x%s ARM %i → %s', (code, arm, model) => {
    expect(resolveModel(code, arm)).toBe(model);
  });

  it('treats All in One Hybrid (82xx) as single-phase, as GivTCP does, although the Python library says three-phase', () => {
    expect(layoutOf('all_in_one_hybrid')).toBe('single_phase');
  });

  it('puts three-phase models on the three-phase register layout', () => {
    expect(layoutOf('hybrid_3ph')).toBe('three_phase');
    expect(layoutOf('ac_3ph')).toBe('three_phase');
    expect(layoutOf('all_in_one_commercial')).toBe('three_phase');
  });

  it('flags EMS and Gateway as plant controllers, which this library refuses', () => {
    expect(isPlantController('ems')).toBe(true);
    expect(isPlantController('gateway')).toBe(true);
    expect(isPlantController('hybrid_gen3')).toBe(false);
  });

  it('returns unknown for an unrecognised code instead of guessing Gen2 (2.x behaviour)', () => {
    expect(resolveModel(0x9001, 0)).toBe('unknown');
  });
});
```

**Step 2: Run the test.** `npx vitest run test/models.test.ts` should FAIL: module not found.

**Step 3: Implement**

```ts
/**
 * Inverter model resolution from HR 0 (device type code) and HR 21 (ARM firmware).
 * See docs/plans/2026-11-19-v3-research.md section A.
 */
export type SinglePhaseModel =
  | 'hybrid_gen1' | 'hybrid_gen2' | 'hybrid_gen3' | 'hybrid_gen3_plus' | 'hybrid_gen4'
  | 'hybrid_hv_gen3' | 'polar' | 'pv' | 'ac' | 'all_in_one' | 'all_in_one_hybrid';
export type ThreePhaseModel = 'hybrid_3ph' | 'ac_3ph' | 'all_in_one_commercial';
export type PlantControllerModel = 'ems' | 'gateway';
export type InverterModel = SinglePhaseModel | ThreePhaseModel;
export type DeviceModel = InverterModel | PlantControllerModel | 'unknown';
export type Layout = 'single_phase' | 'three_phase';

const THREE_PHASE = new Set<DeviceModel>(['hybrid_3ph', 'ac_3ph', 'all_in_one_commercial']);

export function resolveModel(deviceTypeCode: number, armFirmwareVersion: number): DeviceModel {
  const hex = deviceTypeCode.toString(16).padStart(4, '0');
  const two = hex.slice(0, 2);
  switch (two) {
    case '20': {
      const century = Math.floor(armFirmwareVersion / 100);
      if (century === 3) return 'hybrid_gen3';
      if (century === 8 || century === 9) return 'hybrid_gen2';
      return 'hybrid_gen1';
    }
    case '21': return 'polar';
    case '22': return 'hybrid_gen3_plus';
    case '23': return 'pv';
    case '24': case '25': return 'hybrid_gen3';
    case '40': return 'hybrid_3ph';
    case '41': return 'all_in_one_commercial';
    case '51': return 'ems';
    case '80': return 'all_in_one';
    case '81': return 'hybrid_hv_gen3';
    case '82': return 'all_in_one_hybrid';
    case '83': return 'hybrid_gen4';
  }
  switch (hex[0]) {
    case '3': return 'ac';
    case '5': return 'ems';
    case '6': return 'ac_3ph';
    case '7': return 'gateway';
  }
  return 'unknown';
}

export function layoutOf(model: InverterModel): Layout {
  return THREE_PHASE.has(model) ? 'three_phase' : 'single_phase';
}

export function isPlantController(model: DeviceModel): model is PlantControllerModel {
  return model === 'ems' || model === 'gateway';
}

/** True when the model uses an HV battery stack (BCU at 0x70+, modules at 0x50+). */
export function hasHighVoltageBattery(model: InverterModel): boolean {
  return ['all_in_one', 'all_in_one_hybrid', 'hybrid_hv_gen3', 'hybrid_3ph', 'ac_3ph',
    'all_in_one_commercial'].includes(model);
}
```

**Step 4: Run the test.** It should PASS.

**Step 5: Commit.** `git add src/model/models.ts test/models.test.ts && git commit -m "feat: resolve inverter model from device type code and firmware"`

---

### Task 2: Capabilities

**Files:**
- Create: `src/model/capabilities.ts`
- Test: `test/capabilities.test.ts`

**Step 1: Write the failing test.** Cover every row of R-B, including both sides of each firmware
threshold.

```ts
import { describe, it, expect } from 'vitest';
import { capabilitiesFor } from '../src/model/capabilities.js';

describe('capabilitiesFor', () => {
  it('gives the reference Gen3 (ARM 316) ten slots, pause mode and window, and the HR 300 block', () => {
    expect(capabilitiesFor('hybrid_gen3', 316)).toEqual({
      tenSlots: true, perSlotTargets: true, pauseMode: true, pauseWindow: true,
      acSettingsBlock: true, highVoltageBattery: false, smartLoad: false,
    });
  });
  it('gives Gen3 at ARM 302 only the legacy slots (ten slots need ARM > 302)', () => {
    expect(capabilitiesFor('hybrid_gen3', 302).tenSlots).toBe(false);
    expect(capabilitiesFor('hybrid_gen3', 303).tenSlots).toBe(true);
  });
  it('allows the Gen1 pause mode from ARM 187 but never the pause window (Gen1 rejects HR 319/320)', () => {
    expect(capabilitiesFor('hybrid_gen1', 186).pauseMode).toBe(false);
    expect(capabilitiesFor('hybrid_gen1', 187).pauseMode).toBe(true);
    expect(capabilitiesFor('hybrid_gen1', 451).pauseWindow).toBe(false);
  });
  it('allows the AC pause mode from ARM 200, without the window', () => {
    expect(capabilitiesFor('ac', 199).pauseMode).toBe(false);
    expect(capabilitiesFor('ac', 200).pauseMode).toBe(true);
    expect(capabilitiesFor('ac', 282).pauseWindow).toBe(false);
  });
  it('has no pause controls on three-phase', () => {
    expect(capabilitiesFor('hybrid_3ph', 0)).toMatchObject({ pauseMode: false, pauseWindow: false });
  });
  it('gives three-phase slots 3-10 and per-slot targets', () => {
    expect(capabilitiesFor('hybrid_3ph', 0)).toMatchObject({ tenSlots: true, perSlotTargets: true });
  });
  it('never enables smart load (HR 540+ times out on every model seen)', () => {
    for (const m of ['hybrid_gen1', 'hybrid_gen2', 'hybrid_gen3', 'all_in_one'] as const) {
      expect(capabilitiesFor(m, 999).smartLoad).toBe(false);
    }
  });
  it('marks HV battery models', () => {
    expect(capabilitiesFor('hybrid_hv_gen3', 295).highVoltageBattery).toBe(true);
    expect(capabilitiesFor('hybrid_gen3', 316).highVoltageBattery).toBe(false);
  });
});
```

**Step 2: Run the test.** It should FAIL.

**Step 3: Implement** `capabilitiesFor(model: InverterModel, armFirmwareVersion: number): Capabilities`.
- `Capabilities` is an interface with the seven booleans above, each with a JSDoc line citing R-B.
- Rules:
  - **`tenSlots`:** `hybrid_gen4`, `all_in_one`, `all_in_one_hybrid`, `hybrid_hv_gen3`, three-phase,
    and `hybrid_gen3 && arm > 302`.
  - **`perSlotTargets`:** equal to `tenSlots`.
  - **`pauseMode`:** `all_in_one`, `hybrid_gen2`, `hybrid_gen3`, `hybrid_hv_gen3`, `all_in_one_hybrid`,
    plus `ac` at ARM ≥ 200 and `hybrid_gen1` at ARM ≥ 187.
  - **`pauseWindow`:** `pauseMode && model ∉ {ac, hybrid_gen1}`.
  - **`acSettingsBlock`:** `ac`, `all_in_one`, `hybrid_gen3`, `all_in_one_hybrid`. Gen3 is included on the
    reference unit's evidence. A timeout on HR 300 at runtime turns it off; see Task 13.
  - **`highVoltageBattery`:** `hasHighVoltageBattery(model)`.
  - **`smartLoad`:** always `false`.

**Step 4: Run the test.** It should PASS.

**Step 5: Commit.** `feat: compute capabilities from model and firmware`

---

### Task 3: Test fixtures from wire captures and the reference unit

**Files:**
- Create: `test/helpers/capture.ts`
- Create: `test/fixtures/captures/` (copied logs, plus `NOTICE.md`)
- Create: `test/fixtures/gen3-reference.json`
- Create: `scripts/make-reference-fixture.mjs` (one-off, kept so the fixture can be regenerated)
- Test: `test/capture.test.ts`

**Step 1: Copy the captures.**
- Source: the Apache-2.0 captures listed in R-E, from a shallow clone of
  `https://github.com/britkat1980/givenergy-modbus` at `a556333`, under `tests/fixtures/captures/`.
- Copy them into `test/fixtures/captures/<model>.log`, using these names:
  - `hybrid_gen1_arm449.log`
  - `hybrid_gen2_arm920.log`
  - `ac_arm282.log`
  - `all_in_one_arm620.log`
  - `hybrid_3ph.log`
  - `hybrid_hv_gen3_arm295.log`
  - `ems_arm1036.log`
  - `gateway_gaaa0014.log`
- Check the total size: `du -sh test/fixtures/captures`. If a log is over ~1 MB, trim it to the first
  complete refresh cycle and note the trim in `NOTICE.md`.
- `NOTICE.md` must say:
  - the files are from dewet22/givenergy-modbus `tests/fixtures/captures/`, Copyright (c) 2021 Dewet
    Diener, licensed Apache-2.0;
  - the upstream path of each file;
  - "unchanged apart from file name" (or the trim note).
- **Do not copy** anything from GivTCP's `tests/fixtures/captures/shared/`, since it has no licence.

**Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { loadCapture } from './helpers/capture.js';

describe('loadCapture', () => {
  it('decodes rx frames into per-slave holding and input register caches', () => {
    const plant = loadCapture('hybrid_gen2_arm920.log');
    const inverter = plant.slave(0x11);
    expect(inverter.holding.get(0)?.toString(16)).toBe('2003');
    expect(inverter.holding.get(21)).toBe(920);
    expect(inverter.input.size).toBeGreaterThanOrEqual(60);
  });
  it('ignores heartbeats, tx frames and error replies', () => {
    const plant = loadCapture('all_in_one_arm620.log');   // contains an error reply to HR 1100
    expect(plant.slave(0x11).holding.has(1100)).toBe(false);
  });
});
```

**Step 3: Implement `test/helpers/capture.ts`**

```ts
import { readFileSync } from 'node:fs';
import { decodePdu } from '../../src/pdu/decode.js';

export interface SlaveRegisters { holding: Map<number, number>; input: Map<number, number>; meterProduct: Map<number, number>; }
export interface CapturedPlant { slaves: Map<number, SlaveRegisters>; slave(address: number): SlaveRegisters; }

export function loadCapture(name: string): CapturedPlant {
  const text = readFileSync(new URL(`../fixtures/captures/${name}`, import.meta.url), 'utf8');
  const slaves = new Map<number, SlaveRegisters>();
  const get = (a: number) => {
    let s = slaves.get(a);
    if (!s) { s = { holding: new Map(), input: new Map(), meterProduct: new Map() }; slaves.set(a, s); }
    return s;
  };
  for (const line of text.split('\n')) {
    const m = /\brx:?\s+([0-9a-f]+)\s*$/i.exec(line);   // "<ts> rx <hex>" and "rx: <hex>" formats
    if (!m) continue;
    let pdu;
    try { pdu = decodePdu(Buffer.from(m[1], 'hex')); } catch { continue; }
    if (pdu.type !== 'transparent' || pdu.error || pdu.registerValues.length === 0) continue;
    const target = pdu.transparentFunctionCode === 3 ? get(pdu.slaveAddress).holding
      : pdu.transparentFunctionCode === 4 ? get(pdu.slaveAddress).input
      : pdu.transparentFunctionCode === 22 ? get(pdu.slaveAddress).meterProduct : undefined;
    pdu.registerValues.forEach((v, i) => target?.set(pdu.baseRegister + i, v));
  }
  return { slaves, slave: (a) => get(a) };
}
```

If `decodePdu` rejects a frame shape the captures contain, for example dongle LAN-config broadcasts
(function code 0), the `try/catch` skips it. Don't change `decodePdu` for this.

**Step 4: Make the Gen3 reference fixture.**
- `scripts/make-reference-fixture.mjs` reads `dumps/2026-11-19-gen3-full-scan.json` (keys `hr`, `ir`,
  `battery`) and writes `test/fixtures/gen3-reference.json` with the same shape.
- It replaces every serial:
  - inverter serial HR 13–17 → ASCII `FD0000A000`
  - first-battery serial HR 8–12 → `DZ0000B000`
  - battery serial IR 110–114 (battery cache) → `DZ0000B000`
  - inverter serial HR 13–17 again in any pushed copies
- It also writes `"source": "reference Gen3 Hybrid 5 kW, ARM/DSP 316, 2026-11-19, serials replaced"`.
- Then verify that no real serial remains:
  The script itself decodes the real inverter and battery serials from the dump, and exits non-zero
  if either serial, or its unit-specific last six characters, still appears anywhere in the output. Never write
  the real serials into source, the plan or a commit message. Ask the user to check the diff before
  the fixture is committed.

**Step 5: Run the tests.** They should PASS.

**Step 6: Commit.** `test: wire-capture fixtures (Apache-2.0, attributed) and redacted Gen3 reference fixture`

---

## Phase B: Settings catalogue

### Task 4: Catalogue types, codec and type tests

**Files:**
- Create: `src/catalogue/types.ts`
- Create: `src/catalogue/codec.ts`
- Modify: `vitest.config.ts`
- Modify: `package.json` (`"test:types": "vitest run --typecheck.only"`)
- Modify: `.github/workflows/ci.yml` (add `- run: npm run test:types` after `npm test`)
- Test: `test/catalogue-codec.test.ts`, `test/catalogue.test-d.ts`

**Step 1: Turn on vitest typecheck.** In `vitest.config.ts`, add
`typecheck: { include: ['test/**/*.test-d.ts'], tsconfig: './tsconfig.test.json' }`. Create
`tsconfig.test.json` extending `tsconfig.json`, with `"include": ["src", "test"]` and `"noEmit": true`.

**Step 2: Implement `src/catalogue/types.ts`.** No runtime behaviour, so it has no separate test.

```ts
import type { Capabilities } from '../model/capabilities.js';
import type { Layout } from '../model/models.js';

interface SettingBase {
  /** Holding register. A number applies to every layout in `layouts`; an object gives per-layout addresses. */
  register: number | { readonly single_phase?: number; readonly three_phase?: number };
  /** Layouts this setting exists on when `register` is a number. Default: both. */
  layouts?: readonly Layout[];
  /** Name shown in the official GivEnergy app, when it has one. */
  appName?: string;
  /** One-line description for docs and JSDoc. */
  description: string;
  /** Runtime gate on model/firmware. Settings with this are optional in the snapshot. */
  supported?: (capabilities: Capabilities) => boolean;
  /** Read-only: shown in the snapshot, never written. */
  writable?: false;
  /** Writable only through unsafe_setSetting. `risk` is copied into its docs. */
  unsafe?: true;
  risk?: string;
}
export interface BooleanSetting extends SettingBase { kind: 'boolean' }
export interface PercentSetting extends SettingBase { kind: 'percent'; min: number; max: number }
export interface IntegerSetting extends SettingBase { kind: 'integer'; min: number; max: number; scale?: number; unit?: string }
export interface EnumSetting extends SettingBase {
  kind: 'enum';
  values: Readonly<Record<string, number>>;
  /** Values that may be written, when only a subset is allowed (e.g. battery calibration). */
  writableValues?: readonly string[];
}
export interface TimeSetting extends SettingBase { kind: 'time' }
export type SettingDefinition = BooleanSetting | PercentSetting | IntegerSetting | EnumSetting | TimeSetting;

export type ValueOf<D> =
  D extends { kind: 'boolean' } ? boolean :
  D extends { kind: 'percent' | 'integer' } ? number :
  D extends { kind: 'enum'; values: infer V } ? (keyof V & string) | 'unknown' :
  D extends { kind: 'time' } ? string : never;

export type WriteValueOf<D> =
  D extends { kind: 'enum'; writableValues: readonly (infer W)[] } ? W :
  D extends { kind: 'enum'; values: infer V } ? keyof V & string :
  ValueOf<D>;

export type InLayout<D, L extends Layout> =
  D extends { register: number }
    ? D extends { layouts: readonly (infer X)[] } ? (L extends X ? true : false) : true
    : D extends { register: infer R } ? (L extends keyof R ? true : false) : false;
```

**Step 3: Write the failing codec test.** It covers every kind:
- **boolean:** 0 → false, 1 → true. Any non-zero raw value decodes as true.
- **percent:**
  - Integer range check on encode: 101 and 3.5 throw `RangeError`.
  - Decode leaves the raw value as is.
- **integer with scale:** `{ scale: 10 }`. Raw 2300 decodes to 230. Encoding 230 gives 2300, and
  encoding 230.05 throws.
- **enum:**
  - Unknown raw values decode as `'unknown'`.
  - Encoding a value outside `writableValues` throws.
  - Encoding an unknown key throws.
- **time:** raw 1730 decodes to `'17:30'` and raw 0 to `'00:00'`. Encoding `'24:00'` and `'7:5'` throws.
  Encoding `'7:05'` gives 705.

`decodeSetting(definition, raw)` and `encodeSetting(definition, value)` both live in `codec.ts`. Reuse
`validateTime` / `timeToInt` (move them from `src/inverter.ts` to `src/catalogue/codec.ts` and re-export
them from there).

**Step 4: Write the type tests** `test/catalogue.test-d.ts`. They run against a small inline catalogue,
so they're independent of Task 5.

```ts
import { expectTypeOf, test } from 'vitest';
import type { ValueOf, WriteValueOf, InLayout } from '../src/catalogue/types.js';

const sample = {
  flag: { register: 27, kind: 'boolean', description: 'x' },
  split: { register: { single_phase: 110, three_phase: 1109 }, kind: 'percent', min: 4, max: 100, description: 'x' },
  only1: { register: 104, layouts: ['single_phase'], kind: 'boolean', description: 'x' },
  cal: { register: 29, kind: 'enum', values: { stop: 0, start: 1, charge: 3, finish: 7 }, writableValues: ['stop', 'start'], description: 'x' },
} as const;

test('value types follow kind', () => {
  expectTypeOf<ValueOf<typeof sample.flag>>().toEqualTypeOf<boolean>();
  expectTypeOf<ValueOf<typeof sample.cal>>().toEqualTypeOf<'stop' | 'start' | 'charge' | 'finish' | 'unknown'>();
  expectTypeOf<WriteValueOf<typeof sample.cal>>().toEqualTypeOf<'stop' | 'start'>();
});
test('layouts follow the register shape', () => {
  expectTypeOf<InLayout<typeof sample.split, 'three_phase'>>().toEqualTypeOf<true>();
  expectTypeOf<InLayout<typeof sample.only1, 'three_phase'>>().toEqualTypeOf<false>();
  expectTypeOf<InLayout<typeof sample.flag, 'three_phase'>>().toEqualTypeOf<true>();
});
```

**Step 5: Run the tests.** `npm test -- catalogue-codec` and `npm run test:types` should FAIL, then
PASS after implementing.

**Step 6: Commit.** `feat: settings catalogue types and value codec`

---

### Task 5: The catalogue entries

**Files:**
- Create: `src/catalogue/settings.ts`
- Create: `src/catalogue/index.ts`
- Test: `test/catalogue.test.ts`, extend `test/catalogue.test-d.ts`

**Step 1: Write `SETTINGS`** as `{ … } as const satisfies Record<string, SettingDefinition>`.
- Every `description` is one sentence.
- Every `appName` is copied exactly from `website/register-map.md` section 1.
- Registers in the form `110 / 1109` are single-phase / three-phase.

| Key | Register | Kind | Range / values | Gate | Notes |
|---|---|---|---|---|---|
| `acChargeUpperLimitEnabled` | 20 | boolean | | | App "Enable AC Charge Upper % Limit". Gates `acChargeUpperLimit` |
| `ecoMode` | 27 | boolean | | | |
| `batteryCalibration` | 29 | enum | `off 0, discharge 1, setLowerLimit 2, charge 3, setUpperLimit 4, balance 5, setFullCapacity 6, finish 7`; writable `off, discharge, charge` | | App "Battery Calibration". Writes allowed only for 0/1/3 (R-C) |
| `inverterMaxOutputPercent` | 50 | percent 0–100 | | | App "Inverter Max Output Active Power Percent" |
| `dcDischarge` | 59 / 1122 | boolean | | | App "Enable DC Discharge". Three-phase: force discharge enable |
| `acCharge` | 96 / 1112 | boolean | | | App "AC Charge Enable" |
| `forceCharge` | three_phase 1123 | boolean | | | Three-phase only |
| `batteryReserve` | 110 / 1109 | percent 4–100 | | | |
| `batteryChargeRate` | single_phase 111 | integer 0–50, unit `C/100` | | | Fraction of battery C-rating |
| `batteryDischargeRate` | single_phase 112 | integer 0–50, unit `C/100` | | | |
| `batteryCutoff` | 114 / 1078 | percent 4–100 | | | App "Battery Cutoff % Limit" |
| `acChargeUpperLimit` | 116 / 1111 | percent 4–100 | | | On ten-slot firmware charging stops at min(this, slot 1 target) (#576) |
| `realTimeControl` | 166 | boolean | | | |
| `exportPriority` | single_phase 311 | enum `loadFirst 0, batteryFirst 1, gridFirst 2` | | `acSettingsBlock` | |
| `inverterChargePowerPercent` | 313 / 1110 | percent **1–100** | | single: `acSettingsBlock` | Writing 0 is rejected by the inverter |
| `inverterDischargePowerPercent` | 314 / 1108 | percent 1–100 | | single: `acSettingsBlock` | |
| `eps` | single_phase 317 | boolean | | `acSettingsBlock` | App "Enable EPS" |
| `exportLimit` | single_phase 26 | integer 0–65535 W | | | `writable: false` (read only, R-B) |
| `threePhaseExportLimit` | three_phase 1102 | integer W | | | `writable: false` |
| `threePhaseExportLimitEnabled` | three_phase 1103 | boolean | | | `writable: false` |
| `batterySelfHeating` | single_phase 104 | boolean | | | `unsafe: true`, risk from R-F |
| `manualBatteryHeater` | single_phase 172 | boolean | | | `unsafe: true`, risk from R-F |
| `inverterParallelMode` | single_phase 199 | integer 0–4 | | | `unsafe: true`, risk from R-F |
| `forceOffGrid` | single_phase 331 | boolean | | `acSettingsBlock` | `unsafe: true`, risk from R-F |

Read-only identity values (HR 7, 22, 47, 54, 55 …) are **not** settings. They belong to `identity`
(Task 9).

**Step 2: Derived types** in `src/catalogue/index.ts`:

```ts
import { SETTINGS } from './settings.js';
import type { ValueOf, WriteValueOf, InLayout } from './types.js';
import type { Layout } from '../model/models.js';
type C = typeof SETTINGS;
export type SettingKey<L extends Layout> = { [K in keyof C]: InLayout<C[K], L> extends true ? K : never }[keyof C];
type GatedKey<L extends Layout> = { [K in SettingKey<L>]: C[K] extends { supported: unknown } ? K : never }[SettingKey<L>];
export type Settings<L extends Layout> =
  { [K in Exclude<SettingKey<L>, GatedKey<L>>]: ValueOf<C[K]> } & { [K in GatedKey<L>]?: ValueOf<C[K]> };
export type WritableSettingKey<L extends Layout> =
  { [K in SettingKey<L>]: C[K] extends { writable: false } | { unsafe: true } ? never : K }[SettingKey<L>];
export type UnsafeSettingKey<L extends Layout> =
  { [K in SettingKey<L>]: C[K] extends { unsafe: true } ? K : never }[SettingKey<L>];
export type SettingWriteValue<K extends keyof C> = WriteValueOf<C[K]>;
export type SinglePhaseSettings = Settings<'single_phase'>;
export type ThreePhaseSettings = Settings<'three_phase'>;
export function registerFor(key: keyof C, layout: Layout): number | undefined { /* number or per-layout lookup, honouring `layouts` */ }
export { SETTINGS };
```

**Step 3: Runtime tests** (`test/catalogue.test.ts`), parameterised over `Object.entries(SETTINGS)`:
- Every entry has a description.
- Every register is in a block the poller reads for that layout. The list of blocks comes from Task 13;
  for now, assert against `[0,60,120,240,300]` for single-phase and `[0,60,120,1000,1060,1120]` for
  three-phase.
- No two entries share a register within a layout.
- Every `unsafe` entry has a `risk`.
- Encode/decode round-trips at `min`, `max` and one middle value.
- The `appName` for HR 20, 27, 29, 50, 59, 96, 110, 114, 116, 166, 311, 313, 314, 317, 104, 172, 199
  and 331 matches the register map. Hard-code the expected strings in the test.

**Step 4: Type tests** to add to `catalogue.test-d.ts`:
- `'forceCharge'` is not a `SettingKey<'single_phase'>`.
- `'batteryChargeRate'` is not a `SettingKey<'three_phase'>`.
- `'forceOffGrid'` is in `UnsafeSettingKey<'single_phase'>` and not in `WritableSettingKey<'single_phase'>`.
- `'exportLimit'` is not writable.
- `Settings<'single_phase'>['exportPriority']` is optional.

**Step 5: Run the tests.** They should FAIL, then PASS.

**Step 6: Commit.** `feat: settings catalogue for every single-register setting`

---

## Phase C: Snapshot

### Task 6: Snapshot types

**Files:**
- Create: `src/model/snapshot.ts`, which replaces `inverter-snapshot.ts`, `battery-snapshot.ts` and
  `meter-snapshot.ts` (those are deleted in Task 18)
- Test: `test/snapshot.test-d.ts`

**What to write:** the interfaces exactly as in the design doc's section 1, plus the following:

- **Shared groups:** `Identity`, `Status`, `Solar`, `Battery`, `Grid`, `InverterOutput`, `Eps`, `Load`,
  `Schedules`, `BatteryModule`, `Meter`.
- **Group fields:** every field in R-C single-phase input, and every identity register:
  - `Identity`:
    - `serialNumber`
    - `deviceTypeCode`
    - `model`
    - `firmware: { dsp, arm, batteryManagementSystem, modbusVersion }`
    - `batteryType: 'lithium' | 'lead_acid'`
    - `batteryCapacityAh`
    - `meterType: 'ct_or_em418' | 'em115'`
    - `ratedPower?`
    - `batteryMaxPower?`
    - `usbDevice: 'none' | 'wifi' | 'disk' | 'unknown'`
    - `ammeterEnabled`
    - `certification?`
  - `Status`:
    - `inverterStatus: 'waiting' | 'normal' | 'warning' | 'fault' | 'updating' | 'unknown'`
    - `chargeStatus?: 'idle' | 'charging' | 'finishing' | 'discharging' | 'unknown'`
    - `systemMode` (raw number on single-phase; `'offline' | 'grid_tied'` on three-phase)
    - `faultCode` and `warningCode` (4-digit hex strings, from IR 39/40)
    - `faults: string[]`
    - `batteryWarnings: string[]`
    - `systemTime: Date`
    - `hoursOfOperation`
    - `countdownSeconds`
- **Units and suffixes:**
  - Energy fields end in `Kwh`.
  - Power is in W, voltage in V, current in A, frequency in Hz and temperature in °C. Each unit is
    stated in JSDoc together with the register and its scaling.
- **`ThreePhaseSnapshot`:**
  - `grid.phases`, `inverter.phases`, `eps.phases` and `load.phases` are `ThreePhase<{ voltage, current, power }>`.
  - `battery.priority: 'load' | 'battery' | 'grid'`.
  - `status.dcStatus`.
- **`InverterSnapshot`:** `SinglePhaseSnapshot | ThreePhaseSnapshot`.

**Type tests:**
- Narrowing on `layout` gives the right `settings` type.
- `schedules.batteryPause` exists only on `SinglePhaseSnapshot`.

**Commit:** `feat!: v3 snapshot types grouped by subsystem`, with this footer:

```
BREAKING CHANGE: InverterSnapshot is regrouped (identity, status, solar, battery, grid, inverter,
eps, load, settings, schedules), discriminated on `layout` instead of `generation`. See
website/migration-v3.md.
```

### Tasks 7–12: Snapshot builder modules (one task each)

**Files:**
- Create: `src/snapshot/<group>.ts`
- Test: `test/snapshot/<group>.test.ts`

Each module exports a pure function `build<Group>(registers: RegisterCaches, context: BuildContext)`,
where:

```ts
export interface RegisterCaches { holding: Map<number, number>; input: Map<number, number>; }
export interface BuildContext { model: InverterModel; layout: Layout; capabilities: Capabilities; previous?: InverterSnapshot | null; }
```

- Read registers through `readHolding(registers, address)` and `readInput(registers, address)` in
  `src/snapshot/read.ts`. These return `undefined` when a register is missing; values that are always
  present use `?? 0`.
- Move the existing logic out of `snapshot-builder.ts` rather than rewriting it. Reuse
  `src/validation.ts` and `src/model/converters.ts`, and add `toSignedDeci` for temperatures.
- Every test uses fixtures:
  - The Gen3 reference fixture must reproduce the values in `website/register-map.md` sections 1–2.
    Hard-code them, for example battery voltage, temperatures, slots, HR 311 = `loadFirst`, and
    HR 318 = 3 (`both`).
  - At least one capture per other model checks that the group decodes without throwing and gives
    plausible ranges.

| Task | Module | Content | Key quirk tests |
|---|---|---|---|
| 7 | `identity.ts`, `status.ts`, `faults.ts` | Identity registers; IR 0 / 14 / 39 / 40 / 49 / 57; HR 223/224 messages; three-phase IR 1075, 1076, 1124, 1300–1307 | IR 57 decoded LSB-first from IR 57, not IR 56 (old GivTCP bug); three-phase fault words LSB-first; HR 223/224 bit 11 is "Hall Sensor" |
| 8 | `power.ts`: solar, grid, inverter output, eps, load | Single-phase IR 1–59; three-phase IR 1000–1240 | IR 24 is the inverter terminal and IR 30 the grid CT; AC/AIO PV registers echo the AC side, so `solar.strings` is `[]` there; IR 13/54 frequency ×10 fallback; three-phase IR 1083–1085/1091–1093 are signed W, not ÷10 |
| 9 | `energy.ts` | Today and total counters, consumption, battery total fallback | **HR 4109–4112 no longer used** (write-only seeds); fallback order: battery module IR 105/106 (not summed across packs, R-C) → IR 180/181 → IR 27/28/29; three-phase IR 1360–1413 |
| 10 | `battery.ts`, `battery-modules.ts` | Inverter-side battery values; LV modules (all IR 60–115 fields); HV BCU/BMU | Temperatures signed (empty slot −273.0 → module skipped); IR 95 current only trusted per R-C rule; BCU IR 103/105 are max values; capacities ÷100 Ah |
| 11 | `settings.ts`, `schedules.ts` | Generic: for each catalogue key in this layout, include it when `supported?.(capabilities) ?? true` and its register has been read; decode with `decodeSetting`. Schedules from `timeslot-registers.ts` plus capabilities | Slot count 10 vs legacy (charge 94/95 + 31/32, discharge 56/57 + 44/45); targets only with `perSlotTargets`; `batteryPause` from HR 318–320 with no swap; Gen1 has `batteryPause.mode` only; three-phase slots 1113–1121 |
| 12 | `meters.ts`, `src/snapshot/index.ts` | Meter (apparent power raw VA, not ÷10: captures contradict the external library; power factor signed ÷10000); `buildSnapshot()` assembles all groups and keeps the sanity check and power flows | `buildSnapshot` returns `null` on a failed sanity check, including when a sanity register is unread (#583) |

**Commit messages:**
- 7: `feat: decode identity, status and fault registers`
- 8: `feat: decode power groups for both layouts`
- 9: `fix: drop HR 4109-4112 from battery totals (write-only seed registers)`
- 10: `fix: read battery and inverter temperatures as signed`
- 11: `feat: build settings and schedules from the catalogue and capabilities`
- 12: `feat: assemble the v3 snapshot`

---

## Phase D: Polling and control

### Task 13: Poll blocks from capabilities

**Files:**
- Modify: `src/poll-manager.ts`
- Test: `test/poll-manager.test.ts`

**Step 1: Write the failing tests** for `holdingBlocksFor(layout, capabilities, full)` and
`inputBlocksFor(layout, capabilities)`. Export them from `src/poll-blocks.ts`.

| Layout | Holding blocks | Input blocks |
|---|---|---|
| Single-phase | `0`; full refresh adds `60`, `120`, `180` (HR 199 parallel mode); `240` if `tenSlots`; `300` if `acSettingsBlock` | `0`, `180` |
| Three-phase | `0`, `1000`, `1060`, `1120` (count 5); full refresh adds `60`, `120`, `240` | `0`, `180`, then `1000` to `1360` in steps of 60 |

Neither layout reads holding `4080`. Single-phase reads holding `180` only for HR 199 (`inverterParallelMode`); its HR 180 battery total is not used.

- Add a test that every catalogue register for a layout is inside its full-refresh blocks. This replaces
  Task 5's hard-coded list.

**Step 2: Run the tests.** They should FAIL.

**Step 3: Implement.**
- Resolve the model and capabilities after the first HR 0 block is read: `resolveModel(HR0, HR21)` →
  `capabilitiesFor`.
- If the model is a plant controller (EMS or Gateway), stop and throw `UnsupportedDeviceError`.
- **Runtime downgrade:** when a block times out with no push data, three consecutive times, mark it
  unanswered and stop requesting it.
  - Unanswered HR 300 turns `acSettingsBlock` off.
  - Unanswered HR 240 turns `tenSlots` off.
  - Store the downgrade in the poll manager and emit `debug`.
  - Test this with the existing mock-server helpers.

**Step 4: Run the tests.** They should PASS.

**Step 5: Commit.** `feat: derive polled blocks from capabilities and stop requesting unanswered blocks`

### Task 14: Inverter classes, `setSetting` and `unsafe_setSetting`

**Files:**
- Rewrite: `src/inverter.ts`
- Create: `src/errors.ts`
- Delete in Task 18: `src/inverters/`
- Test: rewrite `test/inverter-controls.test.ts`

**Step 1: Write the failing tests** against the existing mock inverter in `inverter-controls.test.ts`.
Feed it the Gen3 reference fixture as holding/input data.

- `connect()` on a Gen3 fixture returns an instance with `layout === 'single_phase'`, `model === 'hybrid_gen3'`.
- `connect()` on an EMS fixture rejects with `UnsupportedDeviceError` and closes the socket.
- `setSetting('batteryReserve', 20)` writes HR 110 = 20, and `getData().settings.batteryReserve === 20`
  straight after the write, with no poll in between.
- Three-phase `setSetting('batteryReserve', 20)` writes HR 1109.
- `setSetting('inverterChargePowerPercent', 0)` throws `RangeError`, because the inverter rejects 0.
- `setSetting('exportPriority', 'gridFirst')` throws `UnsupportedSettingError` when the fixture's
  capabilities have no `acSettingsBlock`. Simulate this with a Gen2 fixture.
- `setSetting('batteryCalibration', 'balance')` is a compile error (type test) and a runtime
  `RangeError` if forced with `as never`.
- `unsafe_setSetting('forceOffGrid', true)` writes HR 331 = 1. `setSetting('forceOffGrid', true)` is a
  compile error (type test).

**Step 2: Implement.**

```ts
export abstract class GivEnergyInverter<L extends Layout> extends EventEmitter {
  abstract readonly layout: L;
  get model(): InverterModel;
  get capabilities(): Capabilities;
  getData(): Extract<InverterSnapshot, { layout: L }>;
  setSetting<K extends WritableSettingKey<L>>(key: K, value: SettingWriteValue<K>): Promise<void>;
  /** @remarks Writes registers no reference implementation has verified. See each setting's `risk`. */
  unsafe_setSetting<K extends UnsafeSettingKey<L>>(key: K, value: SettingWriteValue<K>): Promise<void>;
  setDateTime(date: Date): Promise<void>; syncDateTime(): Promise<void>; reboot(): Promise<void>;
  unsafe_writeRegister(register: number, value: number): Promise<void>;
  static connect(options: GivEnergyInverterOptions): Promise<SinglePhaseInverter | ThreePhaseInverter>;
  static identify(options): Promise<InverterIdentity>;   // returns { serialNumber, deviceTypeCode, model, layout }
}
```

- A shared private `_write(key, value, allowUnsafe)` does the following in order:
  1. Look up the definition.
  2. Check `supported`, and throw `UnsupportedSettingError(key, model, firmware)` if it fails.
  3. Get the register from `registerFor(key, layout)`.
  4. Encode the value with `encodeSetting`.
  5. Write the register.
  6. Call `pollManager.applyWrite(register, raw)`, which updates the holding cache and rebuilds the
     snapshot without a network read.
- `src/errors.ts` exports `UnsupportedDeviceError` and `UnsupportedSettingError`, both extending `Error`
  with a `name` set.

**Step 3: Run the tests.** They should PASS.

**Step 4: Commit.** `feat!: setSetting and unsafe_setSetting replace per-setting methods`, with this
footer:

```
BREAKING CHANGE: setEcoMode, setTimedExport, setTimedCharge, setChargeTarget, setChargeRate(Percent),
setDischargeRate(Percent), setBatteryReserve, setBatteryPowerReserve, setExportLimit,
setBatteryPauseMode, setTimedDischarge and setTimedDischargeSlot are removed. Use
setSetting / setBatteryPause / setChargeSlot.
```

### Task 15: Schedules and battery pause writes

**Files:**
- Modify: `src/inverter.ts`
- Test: `test/inverter-schedules.test.ts`

**Tests:**
- `setChargeSlot(2, …)` writes HR 243/244 when `tenSlots` is set, and HR 31/32 otherwise.
- Slot targets are written only with `perSlotTargets`. Without it, passing `targetStateOfCharge` throws
  `UnsupportedSettingError`, rather than being silently skipped as GivTCP does.
- `setChargeSlots([...])` clears the remaining slots up to the model's slot count.
- On three-phase, slot 1 is written to HR 1113/1114 and discharge slot 2 to HR 1120/1121.
- `setBatteryPause({ mode: 'discharge', start: '16:00', end: '19:00' })` writes HR 318 = 2, HR 319 = 1600
  and HR 320 = 1900, in that order, with no swap.
- `setBatteryPause({ mode: 'charge' })` on Gen1 writes HR 318 only. Passing `start` on Gen1 throws
  `UnsupportedSettingError`, because Gen1 rejects HR 319/320.
- `setBatteryPause` on three-phase is a compile error.

**Implementation:** keep `src/timeslot-registers.ts`. Its existing pinning test must still pass. Add the
legacy charge slot 2 (HR 31/32) alongside it as `LEGACY_CHARGE_SLOT_2`.

**Commit:** `feat: capability-aware schedule and battery pause writes`

---

## Phase E: Exports, scripts, docs, verification

### Task 16: Public exports

Rewrite `src/index.ts` to export:
- the inverter classes;
- the snapshot types;
- `SETTINGS` and the types `SettingKey`, `Settings`, `WritableSettingKey`, `UnsafeSettingKey`,
  `SettingDefinition`;
- `Capabilities`, `InverterModel`, `Layout`;
- the errors;
- `discover`.

Add `test/exports.test.ts`, which imports from `../src/index.js` and asserts that each runtime export
exists.

Commit: `feat!: v3 public exports`

### Task 17: Scripts

- `scripts/snapshot.mjs`: print every group of the nested snapshot. Print `settings` by iterating
  `SETTINGS`, with each `appName`, value and unit. Follow the project rule: "snapshot script should show
  all data available from the API".
- `scripts/write-test.mjs`: use `setSetting`.
  - Keep its existing confirmation prompt.
  - Use `ecoMode`, a no-op toggle back to its current value.
  - It still requires the user to run it themselves.
- `scripts/identify.mjs`: show `model` and `layout`.
- Then run against the real inverter, read only:
  ```bash
  npm run build && node scripts/snapshot.mjs 10.29.0.197 > dumps/2026-11-xx-v3-snapshot.txt 2>&1
  ```
  Compare the output with `website/register-map.md` sections 1–2. Check every ✅ row's value, allowing
  for live drift. List any mismatch in the PR description.

Commit: `chore(scripts): print the v3 snapshot and use setSetting`

### Task 18: Remove the 2.x code

Delete:
- `src/generation.ts`
- `src/model/device-types.ts`
- `src/inverters/`
- `src/snapshot-builder.ts`
- `src/model/inverter-snapshot.ts`, `battery-snapshot.ts`, `meter-snapshot.ts`
- the 2.x tests that only covered removed code

Move any tests that still apply into the new files.

Then run:
- `grep -rn "generation" src` (only comments should remain)
- `npm test && npm run test:types && npm run build`

Commit: `refactor!: remove 2.x generation model and flat snapshot`

### Task 19: Docs

- **`website/migration-v3.md`:**
  - Old field → new path table, covering every `BaseSnapshot` field in 2.x `inverter-snapshot.ts`.
  - Old method → new call table.
  - The `generation` → `layout` / `model` change.
  - The battery pause correction.
- **`website/settings.md`:** generated from the catalogue by `scripts/generate-settings-doc.mjs`, wired
  into `npm run docs` before vitepress. The table shows key, app name, register(s), kind/range, models
  (gate) and safe/unsafe. Unsafe rows include their `risk`.
- **`website/register-map.md`:**
  - Mark HR 313/314 as range 1–100.
  - Section 5: remove questions that are now answered.
- **Sidebar and nav entries** in `website/.vitepress/config.ts`, and update `README.md` examples.
- **`CLAUDE.md`:** add "Use britkat1980/givenergy-modbus (external library GivTCP depends on) as a
  second reference".
- Run `npm run docs`. It must build with no dead links.

Commit: `docs: v3 migration guide and generated settings reference`

### Task 20: Final verification

```bash
npm ci && npm test && npm run test:types && npm run build && npm run docs
```

- All of the above must pass.
- Run the read-only snapshot against the real inverter (Task 17) once more, and save it to `dumps/`.
- Request a code review with superpowers:requesting-code-review.
- Then ask the user before pushing or opening the PR.
