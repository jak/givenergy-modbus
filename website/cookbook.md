# Cookbook

Practical recipes for common tasks. All examples assume you've already connected:

```ts
import { GivEnergyInverter } from 'givenergy-modbus';
const inverter = await GivEnergyInverter.connect({ host: '192.168.1.100' });
```

## Force Charge from Grid

Charge the battery from the grid at full rate. Useful during cheap overnight tariff windows.

```ts
// Save current state to restore later
const before = inverter.getData();
const [slot1] = before.schedules.charge;

// Enable AC charge with an all-day charge slot
await inverter.setSetting('acCharge', true);
await inverter.setChargeSlot(1, { start: '00:00', end: '23:59' });
if (inverter.supports('inverterChargePowerPercent')) {
  await inverter.setSetting('inverterChargePowerPercent', 100);
}

// ... your app waits (timer, cron, automation trigger) ...

// Restore previous state when done
await inverter.setSetting('acCharge', before.settings.acCharge);
if (slot1) await inverter.setChargeSlot(slot1);
```

With `capabilities.perSlotTargets` you can also give the slot a target state of charge
(`targetStateOfCharge: 100`); without it, passing a target throws `UnsupportedSettingError`. On
ten-slot firmware AC charging stops at the lower of `acChargeUpperLimit` and charge slot 1's target.

::: tip
The library doesn't track or revert changes. Your application is responsible for the timer/revert logic — whether that's `setTimeout`, a cron job, or a home automation trigger.
:::

## Force Discharge to Grid

Discharge the battery to the grid. Useful during peak export tariff windows.

```ts
const before = inverter.getData();

await inverter.setSetting('dcDischarge', true);
await inverter.setDischargeSlot(1, { start: '00:00', end: '23:59' });
await inverter.setSetting('batteryReserve', 4);  // don't drain below 4%

// ... wait, then revert ...
await inverter.setSetting('dcDischarge', before.settings.dcDischarge);
await inverter.setSetting('batteryReserve', before.settings.batteryReserve);
```

## Replace the Whole Schedule

`setChargeSlots` and `setDischargeSlots` write slots from 1 in order and clear every slot after the
last one to `00:00`–`00:00`:

```ts
await inverter.setChargeSlots([
  { start: '00:30', end: '04:30' },
  { start: '13:00', end: '15:00' },
]);

// Clear every discharge slot
await inverter.setDischargeSlots([]);
```

Clearing writes the times only, so a cleared slot keeps its old target. The number of slots is 10
with `capabilities.tenSlots`, otherwise 2; passing more throws `RangeError`.

## Battery Pause

Single-phase models with `capabilities.pauseMode` have a battery pause (HR 318) that stops the
battery charging, discharging or both. With `capabilities.pauseWindow` it also has a time window:
HR 319 is the start and HR 320 the end, as the app shows them.

```ts
if (inverter.layout === 'single_phase' && inverter.capabilities.pauseMode) {
  // Pause discharging between 16:00 and 19:00
  if (inverter.capabilities.pauseWindow) {
    await inverter.setBatteryPause({ mode: 'discharge', start: '16:00', end: '19:00' });
  }

  // Or change the mode only
  await inverter.setBatteryPause({ mode: 'charge' }); // don't charge
  await inverter.setBatteryPause({ mode: 'both' });   // freeze the battery
  await inverter.setBatteryPause({ mode: 'off' });    // normal operation

  // Check current state
  const pause = inverter.getData().schedules.batteryPause;
  console.log(pause?.mode);              // 'off' | 'charge' | 'discharge' | 'both' | 'unknown'
  console.log(pause?.start, pause?.end); // '16:00' '19:00'
}
```

Gen1 and AC have the mode but no window. Three-phase inverters have no battery pause. Setting a
pause window in the app also sets the mode to `both`.

## Check What an Inverter Supports

```ts
console.log(inverter.model);        // e.g. 'hybrid_gen3'
console.log(inverter.capabilities); // { tenSlots, perSlotTargets, pauseMode, ... }

if (inverter.supports('exportPriority') && inverter.layout === 'single_phase') {
  await inverter.setSetting('exportPriority', 'batteryFirst');
}
```

`supports(key)` checks that the setting exists on the inverter's layout and passes its model and
firmware gate. The [settings reference](./settings) lists each setting's gate.

## Handle Unsupported Devices and Settings

```ts
import { GivEnergyInverter, UnsupportedDeviceError, UnsupportedSettingError } from 'givenergy-modbus';

try {
  const inverter = await GivEnergyInverter.connect({ host: '192.168.1.100' });
  await inverter.setSetting('inverterChargePowerPercent', 50);
} catch (error) {
  if (error instanceof UnsupportedDeviceError) {
    console.log(`Not an inverter this library supports: ${error.model}`);
  } else if (error instanceof UnsupportedSettingError) {
    console.log(`${error.key} isn't supported on ${error.model} (ARM firmware ${error.firmware})`);
  } else {
    throw error;
  }
}
```

## Monitor Solar Production

```ts
inverter.on('data', (s) => {
  const strings = s.solar.strings.map((string, i) => `PV${i + 1}: ${string.power}W`).join(', ');
  console.log(`Solar: ${s.solar.power}W (${strings})`);
  console.log(`Today: ${s.solar.energyTodayKwh} kWh`);
  console.log(`Total: ${s.solar.energyTotalKwh} kWh`);
});
```

`s.solar.strings` is empty on AC-coupled and All in One models.

## Track Daily Energy

```ts
inverter.on('data', (s) => {
  console.log(`PV generated:    ${s.solar.energyTodayKwh} kWh`);
  console.log(`Battery charged: ${s.battery.energy.chargeTodayKwh} kWh`);
  console.log(`Grid import:     ${s.grid.energy.importTodayKwh} kWh`);
  console.log(`Grid export:     ${s.grid.energy.exportTodayKwh} kWh`);
  console.log(`Consumption:     ${s.load.energyTodayKwh ?? 'n/a'} kWh`);
});
```

Single-phase consumption is derived, and left out on AC-coupled models (`ac`), where the formula
would under-read.

## Log Power Flows

```ts
inverter.on('data', (s) => {
  const pf = s.powerFlows;
  const flows = [
    pf.solarToHouse   && `Solar→House: ${pf.solarToHouse}W`,
    pf.solarToBattery && `Solar→Battery: ${pf.solarToBattery}W`,
    pf.solarToGrid    && `Solar→Grid: ${pf.solarToGrid}W`,
    pf.batteryToHouse && `Battery→House: ${pf.batteryToHouse}W`,
    pf.gridToHouse    && `Grid→House: ${pf.gridToHouse}W`,
    pf.gridToBattery  && `Grid→Battery: ${pf.gridToBattery}W`,
  ].filter(Boolean);

  console.log(flows.join('  |  '));
});
```

## Check Battery Health

```ts
const s = inverter.getData();

for (const module of s.battery.modules) {
  if (module.kind === 'low_voltage') {
    console.log(`Battery ${module.serialNumber}`);
    console.log(`  SOC: ${module.stateOfCharge}%  Voltage: ${module.voltage}V`);
    console.log(`  Cycles: ${module.cycleCount}`);
    console.log(`  Temp: ${module.temperatureMin}–${module.temperatureMax}°C`);
    console.log(`  Cells: ${module.cellVoltages.map(v => v.toFixed(3)).join(', ')}V`);
  } else {
    // High-voltage module: pack-level values live on its stack
    const stack = s.battery.stacks?.find(candidate => candidate.index === module.stack);
    console.log(`Stack ${module.stack} module ${module.index}: ${module.serialNumber}`);
    console.log(`  Stack SOC: ${stack?.stateOfChargeMin}–${stack?.stateOfChargeMax}%  Health: ${stack?.stateOfHealth}%`);
    console.log(`  Temp: ${module.temperatureMin}–${module.temperatureMax}°C`);
  }
}
```
