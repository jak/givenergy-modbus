# Concepts

## Snapshots

A snapshot is a plain JavaScript object containing everything the library knows about the inverter at a point in time. It's built from raw Modbus register values with all GivEnergy protocol quirks applied (scaling, validation, fallbacks).

```ts
const snapshot = inverter.getData();
// snapshot is an InverterSnapshot: a discriminated union on `layout`
```

Snapshots are **immutable values** — each call to `getData()` or each `'data'` event gives you a new object. The library doesn't track history or compute deltas.

### What's in a Snapshot

The snapshot is grouped by subsystem:

| Group | Contents | Example |
|-------|----------|---------|
| `identity` | Serial number, device type code, model, firmware, battery type and capacity | `identity.firmware.arm` |
| `status` | Inverter status, faults, system time | `status.inverterStatus`, `status.faults` |
| `solar` | Total power, per-string voltage/current/power, energy | `solar.power`, `solar.strings[0].voltage` |
| `battery` | Power, voltage, current, state of charge, energy, modules and stacks | `battery.stateOfCharge`, `battery.energy.chargeTodayKwh` |
| `grid` | Grid CT power, voltage (per phase on three-phase), frequency, energy | `grid.power`, `grid.energy.importTodayKwh` |
| `inverter` | AC output power, apparent power, temperatures, inverter energy | `inverter.outputPower`, `inverter.heatsinkTemperature` |
| `eps` | Backup output power, voltage, frequency | `eps.power` |
| `load` | House load and consumption energy | `load.power` |
| `powerFlows` | Derived flows: solar→house, battery→grid, … | `powerFlows.solarToBattery` |
| `meters` | Attached CT meters | `meters[0].activePowerTotal` |
| `settings` | Every setting in the catalogue, by key | `settings.ecoMode`, `settings.batteryReserve` |
| `schedules` | Charge and discharge slots, battery pause | `schedules.charge[0].start` |

Every field's API documentation gives its unit, source register and scaling.

### Absent, not zero

A value the inverter's model or firmware doesn't have, or that hasn't been read, is **absent**: an optional field, or an entry missing from an array. It's never filled with 0. For example, `settings.exportPriority` is `undefined` on an inverter without the HR 300 block, and `schedules.batteryPause` is `undefined` on a model without battery pause.

## Models, Layouts and Capabilities

The library resolves the inverter's **model** from its device type code (HR 0) and ARM firmware version (HR 21) during `connect()`:

| Layout | Models |
|---|---|
| `single_phase` | `hybrid_gen1`, `hybrid_gen2`, `hybrid_gen3`, `hybrid_gen3_plus`, `hybrid_gen4`, `hybrid_hv_gen3`, `polar`, `pv`, `ac`, `all_in_one`, `all_in_one_hybrid` |
| `three_phase` | `hybrid_3ph`, `ac_3ph`, `all_in_one_commercial` |

Energy Management Systems and Gateways are plant controllers, not inverters, and an unknown device type code matches no model: `connect()` and `identify()` reject both with `UnsupportedDeviceError`.

The **layout** decides which registers the inverter uses, so it's what TypeScript narrows on. `connect()` returns a `SinglePhaseInverter` or a `ThreePhaseInverter`, and the snapshot is a [discriminated union](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) on `layout`:

```ts
const snapshot = inverter.getData();

if (snapshot.layout === 'single_phase') {
  // SinglePhaseSnapshot
  console.log(snapshot.grid.voltage);
  console.log(snapshot.schedules.batteryPause?.mode);
} else {
  // ThreePhaseSnapshot
  console.log(snapshot.grid.phases.map(phase => phase.voltage));
}
```

**Capabilities** say what a particular model and firmware supports, at runtime:

| Capability | Meaning |
|---|---|
| `tenSlots` | 10 charge and 10 discharge slots (HR 240–299); otherwise 2 of each |
| `perSlotTargets` | Each slot has its own target state of charge |
| `pauseMode` | Battery pause mode (HR 318), single-phase only |
| `pauseWindow` | Battery pause window (HR 319/320) |
| `acSettingsBlock` | The HR 300–359 settings block (export priority, inverter charge/discharge power, EPS) |
| `highVoltageBattery` | A high-voltage battery stack |
| `smartLoad` | Smart load (HR 540+); false on every known model |

```ts
if (inverter.capabilities.perSlotTargets) {
  await inverter.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 80 });
}
```

Capabilities can be turned off at runtime: if the HR 240 or HR 300 block never answers, `tenSlots` or `acSettingsBlock` is turned off and the block is no longer requested.

## Settings

Every single-register setting is in one catalogue, exported as `SETTINGS`. The catalogue drives the snapshot's `settings` group, `setSetting(key, value)` and the registers the library polls. Names follow the official GivEnergy app where it has one: HR 59 is `dcDischarge` ("Enable DC Discharge"), HR 96 is `acCharge` ("AC Charge Enable").

```ts
console.log(inverter.getData().settings.batteryReserve); // e.g. 4

await inverter.setSetting('batteryReserve', 10);
```

Settings are **independent registers**, not mutually exclusive modes. Eco mode (HR 27), DC discharge (HR 59) and AC charge (HR 96) can each be turned on or off without affecting the others.

- Each setting has a kind (boolean, percent, integer, enum or time), and `setSetting` checks the value before writing.
- A setting that exists on one layout only (for example `batteryChargeRate`, HR 111, single-phase) needs the inverter narrowed on `layout` before `setSetting` accepts its key.
- A gated setting (for example `exportPriority`, which needs `capabilities.acSettingsBlock`) throws `UnsupportedSettingError` where the gate fails. `inverter.supports(key)` checks it.
- Some settings are read only (the installer's export limit).
- Four settings are **unsafe**: the app shows them, but no reference implementation has verified writing them. `setSetting` doesn't accept them; `unsafe_setSetting` does, and its documentation carries each one's risk.

The [settings reference](./settings) lists every setting with its registers, values and gate.

## Schedules

`schedules.charge` and `schedules.discharge` list the slots, slot 1 first. Each entry carries its `slot` number, from 1, and can be passed straight back to `setChargeSlot` or `setDischargeSlot`:

```ts
const { charge } = inverter.getData().schedules;
for (const slot of charge) {
  console.log(`Slot ${slot.slot}: ${slot.start}–${slot.end}`, slot.targetStateOfCharge ?? '');
}
```

An unset slot reads `00:00`–`00:00`. `targetStateOfCharge` is present only with `capabilities.perSlotTargets`, and never on three-phase slots 1 and 2.

### Battery Pause

Single-phase models with `capabilities.pauseMode` have a battery pause at HR 318, and those with `capabilities.pauseWindow` a window at HR 319 (start) and HR 320 (end):

| Mode | HR 318 | Description |
|------|-------|-------------|
| `off` | 0 | Normal operation — battery charges and discharges freely |
| `charge` | 1 | Charging paused |
| `discharge` | 2 | Discharging paused |
| `both` | 3 | Charging and discharging paused |

A value with no name reads as `'unknown'`.

```ts
if (inverter.layout === 'single_phase' && inverter.capabilities.pauseWindow) {
  await inverter.setBatteryPause({ mode: 'discharge', start: '16:00', end: '19:00' });
}
```

::: info 2.x swapped the window
2.x read and wrote HR 319 as the end and HR 320 as the start. 3.0 matches the app. See the [migration guide](./migration-v3#battery-pause-hr-319-320).
:::

## Power Flows

The `powerFlows` field breaks down where energy is flowing right now:

```ts
const pf = snapshot.powerFlows;

pf.solarToHouse;    // solar panels → household load
pf.solarToBattery;  // solar panels → battery charging
pf.solarToGrid;     // solar panels → grid export
pf.batteryToHouse;  // battery → household load
pf.batteryToGrid;   // battery → grid export
pf.gridToHouse;     // grid import → household load
pf.gridToBattery;   // grid import → battery charging
```

All values are in watts. These are derived from the raw power readings using the same allocation logic as GivTCP.

## Sign Conventions

Some power readings are signed:

| Field | Positive | Negative |
|-------|----------|----------|
| `battery.power` | Discharging (battery → house/grid) | Charging (solar/grid → battery) |
| `grid.power` | Exporting (house → grid) | Importing (grid → house) |
| `inverter.outputPower` | Generating | Consuming |

All other power fields (`solar.power`, `load.power`, etc.) are unsigned. Meter values are as the meter reports them and aren't converted to the `grid.power` convention.

## Batteries and Meters

`battery.modules` lists the attached battery modules, discriminated on `kind`:

- `'low_voltage'`: one per battery management system, with its own state of charge, voltage, cell voltages, temperatures, capacities and charge/discharge totals.
- `'high_voltage'`: one per module in a high-voltage stack, with `stack`, `index`, cell voltages and cell temperatures. Pack-level values (state of charge, voltage, current, state of health, energy, cycles) are in `battery.stacks`, one per battery control unit.

`stack` and `index` come from each device's address, so a module that doesn't answer leaves a gap rather than renumbering the others.

The `meters` array contains CT (current transformer) meter data if any are connected. Meters report per-phase voltage, current, power, power factor, frequency, and energy totals. Per-phase values are `[L1, L2, L3]` tuples; a single-phase meter reads 0 on phases 2 and 3.

## Stateless Design

This library is **stateless** — it reads the current inverter state and sends individual register writes. It does not:

- Track what settings it has changed
- Automatically revert settings after a timeout
- Queue or batch writes
- Maintain history of snapshots

Higher-level workflows (force charge for 2 hours, revert to eco at sunrise, etc.) belong in your application. See the [Cookbook](./cookbook) for patterns.
