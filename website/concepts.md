# Concepts

## Snapshots

A snapshot is a plain JavaScript object containing everything the library knows about the inverter at a point in time. It's built from raw Modbus register values with all GivEnergy protocol quirks applied (scaling, validation, fallbacks).

```ts
const snapshot = inverter.getData();
// snapshot is an InverterSnapshot — a discriminated union on `generation`
```

Snapshots are **immutable values** — each call to `getData()` or each `'data'` event gives you a new object. The library doesn't track history or compute deltas.

### What's in a Snapshot

| Category | Fields | Example |
|----------|--------|---------|
| **Power** | `solarPower`, `batteryPower`, `gridPower`, `loadPower` | Real-time watts |
| **Battery** | `stateOfCharge`, `batteryVoltage`, `batteryCurrent` | 75%, 48.0V, 2.5A |
| **Energy today** | `pvEnergyTodayKwh`, `gridImportEnergyTodayKwh`, ... | Daily totals in kWh |
| **Energy total** | `pvEnergyTotalKwh`, `batteryChargeEnergyTotalKwh`, ... | Lifetime totals in kWh |
| **Config** | `ecoMode`, `timedExport`, `timedCharge`, `batteryPauseMode`, `chargeRatePercent`, `batteryReservePercent` | Current settings |
| **Timeslots** | `chargeSlots`, `dischargeSlots` | Scheduled periods |
| **Grid** | `gridVoltage`, `gridFrequency` | AC measurements |
| **Temperature** | `inverterHeatsinkTemp`, `batteryTemperature` | Sensor readings in °C |
| **Peripherals** | `batteries`, `meters` | Attached battery modules and CT meters |
| **Derived** | `powerFlows` | Solar→house, battery→grid, etc. |

## Inverter Generations

GivEnergy inverters come in three generations, each with different capabilities:

| | Gen2 | Gen3 | Three-phase |
|---|---|---|---|
| **Charge slots** | 1 | 10 | 2 |
| **Discharge slots** | 2 | 10 | 2 |
| **Per-slot target SOC** | No | Yes | No |
| **Battery pause mode** | No | Yes | No |
| **Timed discharge** | No | Yes | No |
| **Export limit control** | No | Yes | No |

The library auto-detects the generation during `connect()` and returns the appropriate subclass (`Gen2Inverter`, `Gen3Inverter`, or `ThreePhaseInverter`). The snapshot type is a [discriminated union](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) on the `generation` field:

```ts
const snapshot = inverter.getData();

if (snapshot.generation === 'gen3') {
  // TypeScript knows this is Gen3Snapshot
  console.log(snapshot.batteryPauseMode);          // 'disabled' | 'pause_charge' | ...
  console.log(snapshot.timedDischargeSlot);         // { start: '23:00', end: '00:01' }
  console.log(snapshot.chargeSlots[0].targetStateOfCharge);
}
```

Generation detection uses the device type code (HR 0) and ARM firmware version (HR 21). If those registers aren't available, it falls back to serial number prefix detection — but this is unreliable as many serial prefixes (like "FD" for Gen3) aren't in the prefix map.

## Mode Toggles

Inverter operating modes are **independent toggles**, each controlling a single holding register. They are not mutually exclusive — multiple toggles can be active simultaneously.

| Toggle | Register | Description |
|--------|----------|-------------|
| `ecoMode` | HR(27) | Battery charges from solar only, discharges to meet household load |
| `timedExport` | HR(59) | Battery discharges to the grid on a schedule |
| `timedCharge` | HR(96) | Battery charges on a schedule (timeslots) |

```ts
await inverter.setEcoMode(true);
await inverter.setTimedExport(false);
await inverter.setTimedCharge(true);
```

### Battery Pause Mode (Gen3)

Gen3 inverters have a battery pause mode at HR(318) that controls whether the battery is paused from charging, discharging, or both. This is closely related to timed discharge — setting `pause_discharge` is how the GivEnergy app enables timed discharge.

::: info Terminology
This library follows the **GivEnergy app's** terminology. GivTCP calls HR(59) "enable_discharge" and doesn't model timed discharge as a separate feature. We use "timed export" for HR(59) (exporting to the grid) and "battery pause mode" / "timed discharge" for HR(318-320) (controlling battery discharge behaviour), which matches what users see in the app.
:::

| Mode | Value | Description |
|------|-------|-------------|
| `disabled` | 0 | Normal operation — battery charges and discharges freely |
| `pause_charge` | 1 | Battery will not charge |
| `pause_discharge` | 2 | Battery only discharges during the timed discharge slot |
| `pause_both` | 3 | Battery neither charges nor discharges |

```ts
// Full control over pause mode
await inverter.setBatteryPauseMode('pause_charge');

// Convenience: setTimedDischarge sets pause_discharge / disabled
await inverter.setTimedDischarge(true);  // same as setBatteryPauseMode('pause_discharge')
await inverter.setTimedDischargeSlot({ start: '23:00', end: '00:01' });
```

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
| `batteryPower` | Discharging (battery → house/grid) | Charging (solar/grid → battery) |
| `gridPower` | Exporting (house → grid) | Importing (grid → house) |
| `inverterOutputPower` | Generating | Consuming |

All other power fields (`solarPower`, `loadPower`, etc.) are unsigned.

## Batteries and Meters

The `batteries` array contains a snapshot for each attached battery module. For LV (low-voltage) systems, each module reports its own SOC, voltage, cell voltages, temperatures, and charge/discharge totals. For HV (high-voltage) systems, pack-level data comes from the BCU (Battery Control Unit) and per-cell data from individual BMUs.

The `meters` array contains CT (current transformer) meter data if any are connected. Meters report per-phase voltage, current, power, power factor, frequency, and energy totals.

## Stateless Design

This library is **stateless** — it reads the current inverter state and sends individual register writes. It does not:

- Track what settings it has changed
- Automatically revert settings after a timeout
- Queue or batch writes
- Maintain history of snapshots

Higher-level workflows (force charge for 2 hours, revert to eco at sunrise, etc.) belong in your application. See the [Cookbook](./cookbook) for patterns.
