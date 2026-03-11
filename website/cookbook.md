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
const previousMode = before.mode;

// Switch to timed demand with an all-day charge slot
await inverter.setMode('timed_demand');
await inverter.setChargeSlot(1, {
  start: '00:00',
  end: '23:59',
  targetStateOfCharge: 100,  // Gen3 only — ignored on Gen2
});
await inverter.setChargeRatePercent(100);

// ... your app waits (timer, cron, automation trigger) ...

// Restore previous mode when done
await inverter.setMode(previousMode);
```

::: tip
The library doesn't track or revert changes. Your application is responsible for the timer/revert logic — whether that's `setTimeout`, a cron job, or a home automation trigger.
:::

## Force Discharge to Grid

Discharge the battery to the grid. Useful during peak export tariff windows.

```ts
const before = inverter.getData();

await inverter.setMode('timed_export');
await inverter.setDischargeSlot(1, { start: '00:00', end: '23:59' });
await inverter.setDischargeRatePercent(100);
await inverter.setBatteryReserve(4);  // don't drain below 4%

// ... wait, then revert ...
await inverter.setMode(before.mode);
await inverter.setBatteryReserve(before.batteryReservePercent);
```

## Gen3: Battery Pause Mode

Gen3 inverters have a dedicated pause mode that's simpler than mode switching for short-term holds:

```ts
// Prevent discharging (hold charge)
await inverter.setBatteryPauseMode('pause_discharge');

// Prevent charging (e.g. during expensive import period)
await inverter.setBatteryPauseMode('pause_charge');

// Pause both
await inverter.setBatteryPauseMode('pause_both');

// Resume normal operation
await inverter.setBatteryPauseMode('disabled');
```

The current pause mode is visible in the snapshot:

```ts
const s = inverter.getData();
if (s.generation === 'gen3') {
  console.log(s.batteryPauseMode); // 'disabled' | 'pause_charge' | ...
}
```

## Monitor Solar Production

```ts
inverter.on('data', (s) => {
  console.log(`Solar: ${s.solarPower}W (PV1: ${s.pvString1Power}W, PV2: ${s.pvString2Power}W)`);
  console.log(`Today: ${s.pvEnergyTodayKwh} kWh`);
  console.log(`Total: ${s.pvEnergyTotalKwh} kWh`);
});
```

## Track Daily Energy

```ts
inverter.on('data', (s) => {
  console.log(`PV generated:    ${s.pvEnergyTodayKwh} kWh`);
  console.log(`Battery charged: ${s.batteryChargeEnergyTodayKwh} kWh`);
  console.log(`Grid import:     ${s.gridImportEnergyTodayKwh} kWh`);
  console.log(`Grid export:     ${s.gridExportEnergyTodayKwh} kWh`);
  console.log(`Consumption:     ${s.consumptionEnergyTodayKwh} kWh`);
});
```

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

for (const [i, bat] of s.batteries.entries()) {
  console.log(`Battery ${i + 1}: ${bat.serialNumber}`);
  console.log(`  SOC: ${bat.stateOfCharge}%  Voltage: ${bat.voltage}V`);
  console.log(`  Cycles: ${bat.cycleCount}`);
  console.log(`  Temp: ${bat.temperatureMin}–${bat.temperatureMax}°C`);
  console.log(`  Cells: ${bat.cellVoltages.map(v => v.toFixed(3)).join(', ')}V`);
}
```
