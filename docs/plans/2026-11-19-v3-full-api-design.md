# v3: expose every known register — design

Date: 2026-11-19. Status: approved.

## Goal

Expose every documented register as a typed read value, and every single-register
setting as a typed write, for every inverter model (single-phase and three-phase). This is a
breaking 3.0.0 release. Only Gen3 can be verified against a real device; the other
models are covered by fixture tests built from published wire captures.

Out of scope: raw register access as public API, and undocumented registers.
EMS and Gateway are plant controllers with their own register blocks: they are detected
and `connect()` throws `UnsupportedDeviceError` instead of misreading them as an inverter.

Research behind this design: `docs/plans/2026-11-19-v3-research.md`.

## 0. Model and capabilities (revised after research)

"Generation" is the wrong unit: support depends on the resolved model and its firmware.

- `model` is resolved from HR 0 (device type code) and HR 21 (ARM firmware):
  `hybrid_gen1 | hybrid_gen2 | hybrid_gen3 | hybrid_gen3_plus | hybrid_gen4 | hybrid_hv_gen3 |
  polar | pv | ac | all_in_one | all_in_one_hybrid | all_in_one_commercial | hybrid_3ph | ac_3ph`
  (plus `ems` and `gateway`, which are detected and refused).
- `layout: 'single_phase' | 'three_phase'` is the compile-time discriminant. Three-phase uses
  different registers for schedules, limits and live values (HR 1000+, IR 1000+).
  `all_in_one_hybrid` is single-phase (GivTCP overrides the library on this).
- `capabilities` is computed from model and firmware and drives polling, decoding and
  write gating: `tenSlots`, `pauseMode`, `pauseWindow`, `acSettingsBlock` (HR 300–359),
  `perSlotTargets`, `highVoltageBattery`, `smartLoad` (HR 540+; false on every known model).
- Settings that a model or firmware may not support are optional keys in the type and absent
  at runtime when unsupported. `setSetting` checks capabilities and throws
  `UnsupportedSettingError`.

## 1. Snapshot shape

The flat snapshot becomes nested groups. `layout` is the discriminant so `settings` and
`schedules` narrow per layout; `model` and `capabilities` narrow further at runtime.

```ts
interface SinglePhaseSnapshot {
  layout: 'single_phase';
  model: SinglePhaseModel;
  capabilities: Capabilities;
  identity:  { serialNumber, modelCode, model, firmware: { dsp, arm, bms, modbusVersion },
               batteryType, batteryCapacityAh, meterType };
  status:    { inverterStatus, systemMode, faultCodes, systemTime, hoursOfOperation };
  solar:     { power, strings: [{ voltage, current, power, energyTodayKwh }],
               energyTodayKwh, energyTotalKwh };
  battery:   { power, voltage, current, stateOfCharge, temperature, chargerTemperature,
               energy: { chargeTodayKwh, dischargeTodayKwh, chargeTotalKwh,
                         dischargeTotalKwh, throughputTotalKwh },
               modules: BatteryModule[] };
  grid:      { power, voltage, current, frequency, apparentPower,
               energy: { importTodayKwh, exportTodayKwh, importTotalKwh, exportTotalKwh } };
  inverter:  { outputPower, current, heatsinkTemperature, energy: { acChargeTodayKwh, … } };
  eps:       { power, voltage, frequency };
  load:      { power, energyTodayKwh, energyTotalKwh };
  powerFlows: PowerFlows;
  meters:    Meter[];
  settings:  SinglePhaseSettings;
  schedules: { charge: TimeSlotConfig[], discharge: TimeSlotConfig[],
               batteryPause?: { mode: 'off' | 'charge' | 'discharge' | 'both', start?, end? } };
}
// ThreePhaseSnapshot: same groups, per-phase arrays for grid / inverter / eps, ThreePhaseSettings.
```

`schedules.charge` has 10 entries when `capabilities.tenSlots`, otherwise 1 (charge) and 2
(discharge). `targetStateOfCharge` is present only when `capabilities.perSlotTargets`.
`batteryPause` is present when `capabilities.pauseMode`; `start`/`end` only when
`capabilities.pauseWindow` (Gen1 accepts the mode but rejects HR 319/320).

- Energy fields keep the `Kwh` suffix. Other units are documented in JSDoc.
- Names follow the official app wherever the register map has an app name
  (e.g. HR 59 is `settings.dcDischarge`, not `timedExport`).
- Registers a model or firmware doesn't implement are absent (types and runtime), not zero-filled.

### Battery pause (HR 318–320)

Read and written as the app shows them: HR 319 is the start, HR 320 the end. The 2.x
`setTimedDischargeSlot` swapped them and `setTimedDischarge` wrote HR 318; both are removed.

Verified on the reference Gen3 (2026-11-19): a pause set in the app for 17:30–18:00 is
stored as HR 319 = 1730, HR 320 = 1800. Setting a pause slot in the app also sets HR 318
to 3 (pause both) without the user choosing a mode. In the same dump, a discharge slot of
17:00–17:30 is HR 56/57 = 1700/1730 with HR 59 = 1 and HR 272 = 4.

## 2. Settings catalogue and writes

One declarative entry per single-register setting in `src/catalogue/settings.ts`:

```ts
export const SETTINGS = {
  ecoMode:        { register: 27, kind: 'boolean', appName: 'Enable Eco Mode' },
  batteryReserve: { register: { single_phase: 110, three_phase: 1109 }, kind: 'percent', min: 4, max: 100 },
  batteryHeater:  { register: 104, kind: 'boolean', layouts: ['single_phase'], unsafe: true },
  exportPriority: { register: 311, kind: 'enum', values: { loadFirst: 0, batteryFirst: 1, gridFirst: 2 },
                    supported: c => c.acSettingsBlock },
  …
} as const satisfies Record<string, SettingDefinition>;
```

- Kinds: `boolean`, `percent`, `integer` (optional scale and unit), `enum` (string
  literals), `time`.
- Each entry has `layouts` (compile-time) and an optional `supported(capabilities)` predicate
  (runtime). `SinglePhaseSettings` / `ThreePhaseSettings` and `setSetting(key, value)` are
  inferred from the catalogue; only keys valid for the layout compile.
- The writable set per model follows the external library's manifest plus GivTCP's patches
  (see research doc, section B). Settings not in it are read-only.
- **Unsafe settings.** Registers the official app exposes but no reference implementation
  has verified writing (HR 104 battery self-heating, HR 172 manual battery heater, HR 199
  parallel mode as an integer 0–4, HR 331 force off grid; risk notes in research doc section F) are marked `unsafe: true`. `setSetting` does not
  accept them at compile time; they are written only through
  `unsafe_setSetting(key, value)`, whose JSDoc carries the risk notes.
- `setSetting` validates, encodes, writes one holding register, then updates the local
  cache so `getData()` reflects it immediately.
- The catalogue is exported so apps can enumerate settings.
- Hand-written multi-register writes remain: `setChargeSlot(s)`, `setDischargeSlot(s)`,
  `setBatteryPause({ mode, start, end })`, `setDateTime` / `syncDateTime`, `reboot()`,
  `unsafe_writeRegister`.
- The full poll's holding-register blocks are derived from the catalogue and capabilities per model.
- Removed: the per-setting methods (`setEcoMode`, `setChargeRatePercent`, …) and
  `setChargeRate(watts)`, which silently converted watts to a C-rate percent.

## 3. Read-only values, testing, release

- Decode everything already in `register-lut.ts` and GivTCP's models: inverter status and
  system mode labels, fault and warning codes, firmware and identity registers, extra BMS
  fields (cell temperatures, MOSFET temperature, capacities, cell count, status/warning
  flags), meter product info, three-phase per-phase values.
- Fault and warning decoding: single-phase IR 0 status, IR 39 fault / IR 40 warning (hex,
  bit meanings unconfirmed), IR 57 battery warnings (LSB-first table), HR 223/224 inverter
  fault messages; three-phase IR 1300–1307 (LSB-first). Do not copy the old GivTCP
  MSB-first decoding or the IR 56 battery-warning bug.
- Bug fixes found in research: HR 4109–4112 are write-only seeds, not live totals, so they
  drop out of the battery-total fallback chain; temperatures IR 41/55/56 and battery
  IR 76–81/103/104 are signed; meter apparent power is ÷10; HR 313/314 range is 1–100.
- Tests: catalogue round-trip and validation for every entry; type-level tests that each
  layout's settings type has only its keys and that unsafe keys don't compile in
  `setSetting`; capability tests per model/firmware; fixture snapshot tests per model from
  wire captures (the Apache-2.0 captures from dewet22/givenergy-modbus, with attribution, plus
  the Gen3 dump from the reference unit with serials replaced); quirk tests for HR 319/320
  and HR 318.
- Real-device check on Gen3 with `npm run script:snapshot`, read only. No writes to the
  device without explicit permission.
- `scripts/snapshot.mjs` prints the full nested snapshot; `scripts/write-test.mjs` moves to
  `setSetting`.
- Docs: a settings reference page generated from the catalogue and
  `website/migration-v3.md` mapping old fields and methods to new ones.
- Commits use `feat!:` so release-please cuts 3.0.0. One PR on `feat/v3-full-api`.
