# Migrating from 2.x to 3.0

3.0 is a breaking redesign. The snapshot is nested by subsystem, settings are written through one
catalogue-driven `setSetting`, and "generation" is replaced by the inverter's model, layout and
capabilities. This page maps every 2.x field and method to its 3.0 equivalent, then lists the
behaviour changes.

## At a glance

```ts
// 2.x
const inverter = await GivEnergyInverter.connect({ host });
const s = inverter.getData();
console.log(s.solarPower, s.stateOfCharge, s.gridPower);
await inverter.setEcoMode(true);
await inverter.setBatteryReserve(10);
if (s.generation === 'gen3') await inverter.setBatteryPauseMode('pause_discharge');

// 3.0
const inverter = await GivEnergyInverter.connect({ host });
const s = inverter.getData();
console.log(s.solar.power, s.battery.stateOfCharge, s.grid.power);
await inverter.setSetting('ecoMode', true);
await inverter.setSetting('batteryReserve', 10);
if (inverter.layout === 'single_phase' && inverter.capabilities.pauseMode) {
  await inverter.setBatteryPause({ mode: 'discharge' });
}
```

## From generation to layout, model and capabilities

2.x sorted inverters into three generations (`gen2`, `gen3`, `three_phase`), detected from
HR 0, HR 21 and, as a fallback, the serial number prefix. What an inverter supports depends on
its model and firmware, so 3.0 replaces `generation` with three things:

| 3.0 | What it is | Use it for |
|---|---|---|
| `layout` | `'single_phase'` or `'three_phase'` | Compile-time narrowing. The two layouts use different registers, settings and snapshot shapes. |
| `model` | `'hybrid_gen1'` … `'hybrid_gen4'`, `'hybrid_hv_gen3'`, `'ac'`, `'all_in_one'`, `'hybrid_3ph'`, … | Telling models apart at runtime. Resolved from HR 0 (device type code) and HR 21 (ARM firmware). |
| `capabilities` | `{ tenSlots, perSlotTargets, pauseMode, pauseWindow, acSettingsBlock, highVoltageBattery, smartLoad }` | Checking a feature at runtime, instead of checking the generation. |

All three are on the inverter (`inverter.layout`, `inverter.model`, `inverter.capabilities`) and
on every snapshot (`s.layout`, `s.model`, `s.capabilities`). `capabilities` can change at runtime:
a block that never answers turns its capability off (HR 240 turns off `tenSlots`, HR 300 turns off
`acSettingsBlock`).

| 2.x check | 3.0 check |
|---|---|
| `s.generation === 'three_phase'` | `s.layout === 'three_phase'` |
| `s.generation === 'gen3'` (for battery pause) | `s.layout === 'single_phase' && s.capabilities.pauseMode` |
| `s.generation === 'gen3'` (for 10 slots or slot targets) | `s.capabilities.tenSlots`, `s.capabilities.perSlotTargets` |
| `s.generation === 'gen2'` | `s.model === 'hybrid_gen2'`, or the capability you actually need |
| `inverter instanceof Gen3Inverter` | `inverter.layout === 'single_phase'` plus a capability |

`connect()` now returns `SinglePhaseInverter | ThreePhaseInverter` instead of
`Gen2Inverter | Gen3Inverter | ThreePhaseInverter`.

### Narrowing

Settings that exist on both layouts can be written straight on the result of `connect()`. Settings
that exist on one layout only, and `setBatteryPause`, need the inverter narrowed on `layout` first:

```ts
const inverter = await GivEnergyInverter.connect({ host: '192.168.1.100' });

// Writable on both layouts: no narrowing needed.
await inverter.setSetting('batteryReserve', 10);
await inverter.setSetting('acCharge', true);

if (inverter.layout === 'single_phase') {
  // SinglePhaseInverter: single-phase-only settings and battery pause.
  await inverter.setSetting('batteryChargeRate', 50);
  if (inverter.capabilities.pauseMode) await inverter.setBatteryPause({ mode: 'off' });

  const s = inverter.getData(); // SinglePhaseSnapshot
  console.log(s.grid.voltage, s.schedules.batteryPause?.mode);
} else {
  // ThreePhaseInverter
  await inverter.setSetting('forceCharge', false);

  const s = inverter.getData(); // ThreePhaseSnapshot
  console.log(s.grid.phases.map(phase => phase.voltage));
}
```

A snapshot narrows the same way on `s.layout`. The [settings reference](./settings) lists which
layouts each setting exists on.

## Method changes

| 2.x | 3.0 | Notes |
|---|---|---|
| `setEcoMode(enabled)` | `setSetting('ecoMode', enabled)` | HR 27. |
| `setTimedExport(enabled)` | `setSetting('dcDischarge', enabled)` | HR 59 (three-phase HR 1122): the app's "Enable DC Discharge". |
| `setTimedCharge(enabled)` | `setSetting('acCharge', enabled)` | HR 96 (three-phase HR 1112): the app's "AC Charge Enable". On three-phase, 2.x also wrote HR 1123; that is now its own setting, `setSetting('forceCharge', enabled)` (three-phase only). |
| `setChargeTarget(percent)` | `setSetting('acChargeUpperLimit', percent)` | HR 116 (three-phase HR 1111). On ten-slot firmware charging stops at the lower of this and charge slot 1's target. |
| `setChargeRatePercent(percent)` | `setSetting('inverterChargePowerPercent', percent)` | HR 313 (three-phase HR 1110). Range is now 1–100: the inverter rejects 0. Single-phase needs `capabilities.acSettingsBlock`. |
| `setDischargeRatePercent(percent)` | `setSetting('inverterDischargePowerPercent', percent)` | HR 314 (three-phase HR 1108). As above. |
| `setChargeRate(watts)` | Removed | 2.x silently turned watts into a percentage (watts ÷ 100 into HR 111, or watts ÷ 50 into HR 1110 on three-phase). Write the register's own unit instead: single-phase `setSetting('batteryChargeRate', cPer100)` (HR 111, 0–50, a fraction of the battery's C rating), or `setSetting('inverterChargePowerPercent', percent)` on either layout. |
| `setDischargeRate(watts)` | Removed | As `setChargeRate`: `batteryDischargeRate` (HR 112) or `inverterDischargePowerPercent`. |
| `setBatteryReserve(percent)` | `setSetting('batteryReserve', percent)` | HR 110 (three-phase HR 1109). |
| `setBatteryPowerReserve(percent)` | `setSetting('batteryCutoff', percent)` | HR 114 (three-phase HR 1078): the app's "Battery Cutoff % Limit". |
| `setExportLimit(watts)` (Gen3) | Removed | 2.x wrote HR 2071. 3.0 has no export limit write: `getData().settings.exportLimit` (HR 26; three-phase `threePhaseExportLimit`, HR 1102) is the installer's export limit, read only. |
| `setBatteryPauseMode(mode)` (Gen3) | `setBatteryPause({ mode })` | Single-phase only, needs `capabilities.pauseMode`. Modes renamed: `disabled` → `off`, `pause_charge` → `charge`, `pause_discharge` → `discharge`, `pause_both` → `both`. |
| `setTimedDischarge(enabled)` (Gen3) | `setBatteryPause({ mode: enabled ? 'discharge' : 'off' })` | 2.x wrote HR 318 the same way. |
| `setTimedDischargeSlot({ start, end })` (Gen3) | `setBatteryPause({ mode, start, end })` | `mode` is required, and the window needs `capabilities.pauseWindow`. 2.x wrote the window to the wrong registers; see [Battery pause](#battery-pause-hr-319-320). |
| `setChargeSlot(slot, config)` | `setChargeSlot(slot, config)` or `setChargeSlot({ slot, ...config })` | The slot count follows `capabilities.tenSlots` (10, otherwise 2), not the generation: Gen2 now has charge slot 2 (HR 31/32) and three-phase has 10 slots on ten-slot firmware. `targetStateOfCharge` throws `UnsupportedSettingError` where the slot has no target register; 2.x silently ignored it. |
| `setChargeSlots(configs)` | `setChargeSlots(configs)` | Clears every slot after the last one to `00:00`–`00:00`, writing the times only: a cleared slot keeps its old target. An entry's `slot`, when given, must match its position. |
| `setDischargeSlot(slot, config)` / `setDischargeSlots(configs)` | Same names | As the charge slot methods. |
| `setDateTime(date)` | `setDateTime(date)` | Now throws `RangeError` for an invalid date or a year outside 2000–2099 before writing anything. |
| `syncDateTime()`, `reboot()`, `unsafe_writeRegister(register, value)`, `stop()` | Unchanged | |
| `getData()` | `getData()` | Returns the snapshot type for the inverter's layout. |
| `GivEnergyInverter.identify(options)` → `{ serialNumber, generation, modelCode }` | `GivEnergyInverter.identify(options)` → `{ serialNumber, deviceTypeCode, model, layout }` | Rejects with `UnsupportedDeviceError` for EMS, Gateway and unknown devices. |
| `discover()` devices `{ host, serialNumber, generation, modelCode }` | `{ host, serialNumber, deviceTypeCode, model, layout }` | `DiscoveredDevice` extends `InverterIdentity`. |
| — | `inverter.supports(key)` | New: whether a setting exists on this layout and passes its model and firmware gate. |
| — | `unsafe_setSetting(key, value)` | New: writes the four [unsafe settings](./settings), which `setSetting` doesn't accept. |

`setSetting` also covers settings 2.x had no method for. See the [settings reference](./settings)
for every key, its registers, values and gate.

### Removed exports

| 2.x export | 3.0 |
|---|---|
| `Gen2Inverter`, `Gen3Inverter` | `SinglePhaseInverter` |
| `ThreePhaseInverter` | `ThreePhaseInverter` (new API) |
| `detectGeneration`, `modelToGeneration`, `InverterGeneration` | `model` / `layout` on the inverter, snapshot and `identify()` result |
| `Gen2Snapshot`, `Gen3Snapshot` | `SinglePhaseSnapshot` |
| `BatterySnapshot` | `BatteryModule` (`LowVoltageBatteryModule \| HighVoltageBatteryModule`) |
| `MeterSnapshot` | `Meter` |
| `TimeSlot` | `TimeSlotConfig` |
| `BatteryPauseMode` | `BatteryPause['mode']` |

## Snapshot fields

`s` is the snapshot from `getData()` or a `data` event.

### Identity and status

| 2.x | 3.0 | Notes |
|---|---|---|
| `generation` | `s.layout`, `s.model`, `s.capabilities` | See [above](#from-generation-to-layout-model-and-capabilities). |
| `serialNumber` | `s.identity.serialNumber` | |
| `modelCode` | `s.identity.deviceTypeCode` | Renamed: HR 0 is the device type code. |
| `systemTime` | `s.status.systemTime` | |
| `hoursOfOperation` | `s.status.hoursOfOperation` | Single-phase only, optional: absent unless IR 47 and IR 48 were both read, and when it reads over 100 years (a bad read). |

### Solar

| 2.x | 3.0 | Notes |
|---|---|---|
| `solarPower` | `s.solar.power` | |
| `pvString1Power` / `pvString2Power` | `s.solar.strings[0].power` / `s.solar.strings[1].power` | `strings` is empty on AC and All in One models, whose PV registers echo the AC side. |
| `pvString1Voltage` / `pvString2Voltage` | `s.solar.strings[n].voltage` | |
| `pvString1Current` / `pvString2Current` | `s.solar.strings[n].current` | |
| `pvString1EnergyTodayKwh` / `pvString2EnergyTodayKwh` | `s.solar.strings[n].energyTodayKwh` | |
| `pvEnergyTodayKwh` | `s.solar.energyTodayKwh` | |
| `pvEnergyTotalKwh` | `s.solar.energyTotalKwh` | |

### Battery

| 2.x | 3.0 | Notes |
|---|---|---|
| `batteryPower` | `s.battery.power` | Sign unchanged: positive is discharging. |
| `batteryVoltage` | `s.battery.voltage` | |
| `batteryCurrent` | `s.battery.current` | |
| `stateOfCharge` | `s.battery.stateOfCharge` | |
| `batteryTemperature` | `s.battery.temperature` | Single-phase only. Now signed. |
| `chargerTemperature` | `s.battery.chargerTemperature` | Single-phase only. Now signed. |
| `batteryChargeEnergyTodayKwh` | `s.battery.energy.chargeTodayKwh` | Gen1 now reads IR 183 instead of IR 36. |
| `batteryDischargeEnergyTodayKwh` | `s.battery.energy.dischargeTodayKwh` | Gen1 now reads IR 182 instead of IR 37. |
| `batteryChargeEnergyTotalKwh` | `s.battery.energy.chargeTotalKwh` | Now optional. See [battery totals](#battery-energy-totals). |
| `batteryDischargeEnergyTotalKwh` | `s.battery.energy.dischargeTotalKwh` | Now optional. See [battery totals](#battery-energy-totals). |
| `batteryThroughputTotalKwh` | `s.battery.energy.throughputTotalKwh` | Optional, single-phase only. |
| `batteries` | `s.battery.modules` | `BatteryModule[]`, discriminated on `kind`. |

### Battery modules

2.x had one `BatterySnapshot` shape for every module. 3.0 has `LowVoltageBatteryModule`
(`kind: 'low_voltage'`, one per battery management system) and `HighVoltageBatteryModule`
(`kind: 'high_voltage'`, one per battery module of a high-voltage stack). Pack-level high-voltage
values live in `s.battery.stacks[]`, one per battery control unit, instead of being copied onto
every module.

| 2.x `BatterySnapshot` | Low-voltage module | High-voltage | Notes |
|---|---|---|---|
| `serialNumber` | `serialNumber` | `serialNumber` | |
| `stateOfCharge` | `stateOfCharge` | `s.battery.stacks[stack].stateOfChargeMax` / `stateOfChargeMin` | 2.x copied the stack's maximum onto every high-voltage module. |
| `voltage` | `voltage` | `s.battery.stacks[stack].voltage` | 2.x copied the stack voltage onto every module. |
| `dischargeEnergyTotalKwh` | `dischargeTotalKwh` | `s.battery.stacks[stack].energy.dischargeTotalKwh` | Renamed. 2.x reported 0 on high-voltage modules. |
| `chargeEnergyTotalKwh` | `chargeTotalKwh` | `s.battery.stacks[stack].energy.chargeTotalKwh` | Renamed. 2.x reported 0 on high-voltage modules. |
| `temperatureMax` | `temperatureMax` | `temperatureMax` | Now signed. High-voltage: over the module's own sensors (12 on every capture); 2.x read 24 values. |
| `temperatureMin` | `temperatureMin` | `temperatureMin` | As `temperatureMax`. |
| `cycleCount` | `cycleCount` | `s.battery.stacks[stack].cycleCount` | 2.x copied the stack's count onto every module. |
| `cellVoltages` | `cellVoltages` | `cellVoltages` | |
| `stack` | — | `stack` | Required on high-voltage modules, absent on low-voltage. |
| — | — | `index` | New: the module's position in its stack. |

`stack` and `index` come from each device's address, so a module that doesn't answer leaves a gap
instead of renumbering the ones after it. Find a module's stack with
`s.battery.stacks?.find(stack => stack.index === module.stack)`.

```ts
for (const module of s.battery.modules) {
  if (module.kind === 'low_voltage') {
    console.log(module.serialNumber, module.stateOfCharge, module.voltage);
  } else {
    const stack = s.battery.stacks?.find(candidate => candidate.index === module.stack);
    console.log(module.serialNumber, stack?.stateOfChargeMax, module.temperatureMax);
  }
}
```

### Grid

| 2.x | 3.0 | Notes |
|---|---|---|
| `gridPower` | `s.grid.power` | IR 30, the grid CT. Positive is export. |
| `gridVoltage` | `s.grid.voltage` | Single-phase. Three-phase: `s.grid.phases[n].voltage`. |
| `gridFrequency` | `s.grid.frequency` | |
| `gridApparentPower` | `s.inverter.apparentPower` | Moved: IR 43 is measured at the inverter's AC terminal, not at the grid CT. |
| `gridImportEnergyTodayKwh` | `s.grid.energy.importTodayKwh` | |
| `gridExportEnergyTodayKwh` | `s.grid.energy.exportTodayKwh` | |
| `gridImportEnergyTotalKwh` | `s.grid.energy.importTotalKwh` | |
| `gridExportEnergyTotalKwh` | `s.grid.energy.exportTotalKwh` | |

### Inverter

| 2.x | 3.0 | Notes |
|---|---|---|
| `inverterOutputPower` | `s.inverter.outputPower` | |
| `inverterCurrent` | `s.inverter.current` | Single-phase only (IR 10). |
| `inverterHeatsinkTemp` | `s.inverter.heatsinkTemperature` | Renamed, and now signed. |

### EPS, load and power flows

| 2.x | 3.0 | Notes |
|---|---|---|
| `epsBackupPower` | `s.eps.power` | |
| `epsBackupVoltage` | `s.eps.voltage` | Single-phase. Three-phase: `s.eps.phases[n].voltage`. |
| `epsBackupFrequency` | `s.eps.frequency` | |
| `loadPower` | `s.load.power` | |
| `consumptionEnergyTodayKwh` | `s.load.energyTodayKwh` | Single-phase: optional, absent on `ac` (see [behaviour changes](#consumption-on-ac-coupled-inverters)). Three-phase reads it directly (IR 1396–1397). |
| `consumptionEnergyTotalKwh` | `s.load.energyTotalKwh` | As above (three-phase IR 1398–1399). |
| `powerFlows` | `s.powerFlows` | `PowerFlows` is unchanged. |

### Settings

Settings come from the catalogue and follow the official app's names. The
[settings reference](./settings) lists every one.

| 2.x | 3.0 | Notes |
|---|---|---|
| `ecoMode` | `s.settings.ecoMode` | |
| `timedExport` | `s.settings.dcDischarge` | HR 59 (three-phase HR 1122). |
| `timedCharge` | `s.settings.acCharge` | HR 96 (three-phase HR 1112). |
| `chargeTargetStateOfCharge` | `s.settings.acChargeUpperLimit` | HR 116 (three-phase HR 1111). |
| `batteryReservePercent` | `s.settings.batteryReserve` | |
| `chargeRatePercent` | `s.settings.inverterChargePowerPercent` | Optional: absent when the model lacks the HR 300 block. |
| `dischargeRatePercent` | `s.settings.inverterDischargePowerPercent` | As above. |

### Schedules

| 2.x | 3.0 | Notes |
|---|---|---|
| `chargeSlots` | `s.schedules.charge` | Always `TimeSlotConfig[]`, each with a `slot` number. |
| `dischargeSlots` | `s.schedules.discharge` | As above. |
| `batteryPauseMode` (Gen3) | `s.schedules.batteryPause?.mode` | Single-phase only, present with `capabilities.pauseMode`. Values renamed as in `setBatteryPause`. A value HR 318 has no name for reads `'unknown'` (2.x read it as `disabled`). |
| `timedDischargeSlot` (Gen3) | `s.schedules.batteryPause?.start` / `.end` | Present with `capabilities.pauseWindow`. **Swapped back**, see [Battery pause](#battery-pause-hr-319-320). |

`TimeSlotConfig` changes:

| 2.x | 3.0 | Notes |
|---|---|---|
| `TimeSlot` (`{ start, end }`) | `TimeSlotConfig` without `targetStateOfCharge` | `TimeSlot` is gone. |
| `targetStateOfCharge: number` | `targetStateOfCharge?: number` | Present with `capabilities.perSlotTargets`, never on three-phase slots 1 and 2. |
| — | `slot: number` | New: the slot number from 1, as the app numbers them. It comes from the slot's registers, not its array position. |

A slot entry can be passed straight back to `setChargeSlot`, which takes the number from `slot`:

```ts
const [first] = inverter.getData().schedules.charge;
if (first) await inverter.setChargeSlot({ ...first, end: '05:30' });
```

### Meters

`meters: MeterSnapshot[]` is now `s.meters: Meter[]`. Fields are unchanged except:

| 2.x | 3.0 | Notes |
|---|---|---|
| `serialNumber`, `factoryCode`, `meterType`, `hardwareVersion`, `softwareVersion` | Same names | Now optional: absent when the meter's product registers (function 22, 60–66) weren't read. 2.x zero-filled them. |
| `importReactiveEnergy` | `importReactiveEnergyKvarh` | Unit suffix added. |
| `exportReactiveEnergy` | `exportReactiveEnergyKvarh` | Unit suffix added. |
| `apparentPower`, `apparentPowerTotal` | Same names | Still raw VA, but now unsigned: 2.x read them signed, which wrapped above 32767 VA. |
| `powerFactor`, `powerFactorTotal` | Same names | **Decoding fixed**, see [behaviour changes](#meter-power-factor). |
| `ThreePhase<T>` (mutable tuple) | `ThreePhase<T>` (readonly tuple) | |

## Battery pause (HR 319/320)

The battery pause window is HR 319 (start) and HR 320 (end), as the app shows them: a pause set in
the app for 17:30–18:00 is stored as HR 319 = 1730 and HR 320 = 1800 on the reference Gen3.

2.x had them the wrong way round. `timedDischargeSlot.start` read HR 320 and `.end` read HR 319,
and `setTimedDischargeSlot({ start, end })` wrote `start` to HR 320 and `end` to HR 319. 3.0 reads
and writes HR 319 as `start` and HR 320 as `end`, with no swap.

- **Reading:** a window that 2.x showed as `{ start: '18:00', end: '17:30' }` shows as
  `{ start: '17:30', end: '18:00' }`, matching the app.
- **Writing:** if you stored times from 2.x's `timedDischargeSlot` and write them back with
  `setBatteryPause`, swap them, or the inverter gets a different window from the one it had.

```ts
// 2.x
await inverter.setBatteryPauseMode('pause_discharge');
await inverter.setTimedDischargeSlot({ start: '16:00', end: '19:00' }); // wrote HR 320 = 1600, HR 319 = 1900

// 3.0: writes HR 318 = 2, HR 319 = 1600, HR 320 = 1900, in that order
if (inverter.layout === 'single_phase' && inverter.capabilities.pauseWindow) {
  await inverter.setBatteryPause({ mode: 'discharge', start: '16:00', end: '19:00' });
}
```

`setBatteryPause` needs `capabilities.pauseMode`. The window (`start` and `end`, both or neither)
also needs `capabilities.pauseWindow`: Gen1 and AC have the mode only, and Gen1 rejects any access
to HR 319/320. Three-phase inverters have no battery pause. Setting a pause window in the app also
sets HR 318 to 3 (pause both).

## Behaviour changes

### Absent, not zero

A register a model or firmware doesn't implement, or that wasn't read, is now absent: an optional
field, or an entry left out of an array. 2.x filled these with 0, `'00:00'` or `disabled`, which
couldn't be told apart from a real reading. Check for `undefined` on:

- gated settings in `s.settings` (`inverterChargePowerPercent`, `exportPriority`, `eps`, …);
- `s.schedules.batteryPause` and its `start`/`end`;
- `targetStateOfCharge` on slots;
- `s.battery.energy.chargeTotalKwh`, `dischargeTotalKwh` and `throughputTotalKwh`;
- `s.status.hoursOfOperation`, `s.load.energyTodayKwh` and `s.load.energyTotalKwh` on single-phase;
- `s.battery.stacks`;
- meter product fields (`serialNumber`, `factoryCode`, `meterType`, `hardwareVersion`, `softwareVersion`).

A slot whose start or end register is unread is left out of `s.schedules`, and so is an unread
target. The full poll reads every slot register, so this only happens with partial data. Each
slot carries its own `slot` number, so a gap doesn't renumber the slots after it.

### Slot numbers from 1, and slot counts by capability

Slot methods take slot numbers from 1, as 2.x did, and every snapshot slot now carries its
number as `slot`. The number of slots follows `capabilities.tenSlots`, not the generation:

- ten-slot firmware has 10 charge and 10 discharge slots, including three-phase (2.x had 2);
- otherwise 2 of each: charge slot 2 is HR 31/32 (2.x Gen2 had charge slot 1 only), and
  discharge slot 2 is HR 44/45;
- on ten-slot firmware charge slot 2 is HR 243/244, because HR 31/32 writes return an error there.

### Battery energy totals

`s.battery.energy.chargeTotalKwh` and `dischargeTotalKwh` changed source:

- HR 4109–4112 are no longer read. They are write-only seed registers, not live counters.
- There is no fallback to IR 27–28 (the AC charge total) or IR 29, and HR 180 is no longer read
  as a discharge total: on the reference Gen3 it reads 0x5858 (the text "XX"). The order is now
  high-voltage stacks (summed), then the first low-voltage module, then the inverter's IR 181
  (charge) and IR 180 (discharge).
- Low-voltage module totals (IR 105/106) are stack-level and identical across packs, so they are
  no longer summed.
- Both totals are absent when every source reads 0. On three-phase (IR 1390–1395) they are absent
  when unread or when both read 0.

### Signed temperatures

Inverter heatsink, charger and battery temperatures (IR 41, 55, 56), three-phase temperatures
(IR 1128–1130) and low-voltage module temperatures (IR 76–81, 103, 104) are now signed. 2.x read
a sub-zero temperature as about 6550 °C.

### Meter power factor

Meter power factor is now decoded as raw ÷ 10000 − 1. 2.x read it as signed ÷ 10000, which gave
values above 1 on every capture (for example 1.998). The new decoding matches |active ÷ apparent|.
On a single-phase meter (phase 2 and 3 voltage 0), phases 2 and 3 read 0, not the −1 that a raw 0
decodes to.

Meter apparent power stays raw VA, now unsigned. Meter values are as the meter reports them and
are not normalised to the grid sign convention.

### Consumption on AC-coupled inverters

Single-phase consumption is derived as import − export + inverter output − AC charge. On `ac`
models the PV inverter's generation never reaches the inverter output register, so the formula
under-reads (one capture gives −30.9 kWh for today, which 2.x clamped to 0). 3.0 leaves
`s.load.energyTodayKwh` and `energyTotalKwh` out on `ac`.

### Unknown devices, EMS and Gateway are refused

2.x treated any device it couldn't place as Gen2. 3.0 resolves the model from HR 0 and HR 21 and
rejects with `UnsupportedDeviceError` when:

- the device type code matches no known model (including 0); or
- the device is a plant controller: an Energy Management System or a Gateway. These aren't
  inverters and have their own register blocks.

`connect()` and `identify()` reject; `discover()` leaves such devices out of its results.

```ts
import { GivEnergyInverter, UnsupportedDeviceError } from 'givenergy-modbus';

try {
  const inverter = await GivEnergyInverter.connect({ host: '192.168.1.100' });
  console.log(inverter.model);
} catch (error) {
  if (error instanceof UnsupportedDeviceError) console.log(`Not supported: ${error.model}`);
  else throw error;
}
```

### Writes are checked against the model

`setSetting` checks the setting's gate and throws `UnsupportedSettingError` when the model or
firmware doesn't support it (for example `exportPriority` without `capabilities.acSettingsBlock`).
Values are validated before anything is written: percentages and integers outside their range
throw `RangeError`, and an unknown enum name throws. Battery calibration accepts only `off`,
`discharge` and `charge`. Use `inverter.supports(key)` to check first.

The snapshot shows a written setting as soon as the inverter accepts the write, without waiting for
the next poll.

### Renamed to match the app

Where the official app has a name for a register, 3.0 uses it: `timedExport` is `dcDischarge`
("Enable DC Discharge"), `timedCharge` is `acCharge` ("AC Charge Enable"), the charge target is
`acChargeUpperLimit` ("AC Charge Upper % Limit") and the battery power reserve is `batteryCutoff`
("Battery Cutoff % Limit").
