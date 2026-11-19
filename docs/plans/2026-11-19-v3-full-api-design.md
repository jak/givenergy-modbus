# v3: expose every known register — design

Date: 2026-11-19. Status: approved.

## Goal

Expose every documented register as a typed read value, and every single-register
setting as a typed write, for all generations (Gen2, Gen3, three-phase). This is a
breaking 3.0.0 release. Only Gen3 can be verified against a real device; the other
generations are covered by fixture tests built from GivTCP's model files.

Out of scope: raw register access as public API, gateway / EMS models, and undocumented
registers (e.g. HR 480–486).

## 1. Snapshot shape

The flat snapshot becomes nested groups. `generation` stays the discriminant so
`settings` and `schedules` narrow per generation.

```ts
interface Gen3Snapshot {
  generation: 'gen3';
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
  settings:  Settings<'gen3'>;
  schedules: { charge: TimeSlotConfig[], discharge: TimeSlotConfig[],
               batteryPause: { mode: 'off' | 'charge' | 'discharge' | 'both', start, end } };
}
```

- Energy fields keep the `Kwh` suffix. Other units are documented in JSDoc.
- Names follow the official app wherever the register map has an app name
  (e.g. HR 59 is `settings.dcDischarge`, not `timedExport`).
- Registers a generation doesn't implement are absent from its types, not zero-filled.

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
  batteryReserve: { register: { default: 110, three_phase: 1109 }, kind: 'percent', min: 4, max: 100 },
  batteryHeater:  { register: 104, kind: 'boolean', generations: ['gen3'] },
  …
} as const satisfies Record<string, SettingDefinition>;
```

- Kinds: `boolean`, `percent`, `integer` (optional scale and unit), `enum` (string
  literals), `time`.
- `Settings<G>` and `setSetting(key, value)` are inferred from the catalogue; only keys
  valid for the inverter's generation compile.
- `setSetting` validates, encodes, writes one holding register, then updates the local
  cache so `getData()` reflects it immediately.
- The catalogue is exported so apps can enumerate settings.
- Hand-written multi-register writes remain: `setChargeSlot(s)`, `setDischargeSlot(s)`,
  `setBatteryPause({ mode, start, end })`, `setDateTime` / `syncDateTime`, `reboot()`,
  `unsafe_writeRegister`.
- The full poll's holding-register blocks are derived from the catalogue per generation.
- Removed: the per-setting methods (`setEcoMode`, `setChargeRatePercent`, …) and
  `setChargeRate(watts)`, which silently converted watts to a C-rate percent.

## 3. Read-only values, testing, release

- Decode everything already in `register-lut.ts` and GivTCP's models: inverter status and
  system mode labels, fault and warning codes, firmware and identity registers, extra BMS
  fields (cell temperatures, MOSFET temperature, capacities, cell count, status/warning
  flags), meter product info, three-phase per-phase values.
- Tests: catalogue round-trip and validation for every entry; type-level tests that
  `Settings<G>` contains only that generation's keys; fixture snapshot tests per generation
  (Gen3 fixture from the real dump with serials replaced); quirk tests for HR 319/320 and
  HR 318.
- Real-device check on Gen3 with `npm run script:snapshot`, read only. No writes to the
  device without explicit permission.
- `scripts/snapshot.mjs` prints the full nested snapshot; `scripts/write-test.mjs` moves to
  `setSetting`.
- Docs: a settings reference page generated from the catalogue and
  `website/migration-v3.md` mapping old fields and methods to new ones.
- Commits use `feat!:` so release-please cuts 3.0.0. One PR on `feat/v3-full-api`.
