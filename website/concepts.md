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
| **Config** | `mode`, `enableCharge`, `chargeRatePercent`, `batteryReservePercent` | Current settings |
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
| **Export limit control** | No | Yes | No |

The library auto-detects the generation during `connect()` and returns the appropriate subclass (`Gen2Inverter`, `Gen3Inverter`, or `ThreePhaseInverter`). The snapshot type is a [discriminated union](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) on the `generation` field:

```ts
const snapshot = inverter.getData();

if (snapshot.generation === 'gen3') {
  // TypeScript knows this is Gen3Snapshot
  console.log(snapshot.batteryPauseMode);
  console.log(snapshot.chargeSlots[0].targetStateOfCharge);
}
```

Generation detection uses the device type code (HR 0) and ARM firmware version (HR 21). If those registers aren't available, it falls back to serial number prefix detection — but this is unreliable as many serial prefixes (like "FD" for Gen3) aren't in the prefix map.

## Operating Modes

The inverter's operating mode is derived from two holding registers:

| Mode | Description |
|------|-------------|
| `eco` | Battery charges from solar only, discharges to meet household load. Grid import/export happens naturally. |
| `timed_demand` | Battery charges and discharges on a schedule (timeslots). Used for cheap-rate charging and peak-rate discharging. |
| `timed_export` | Battery discharges to the grid on a schedule. Used for grid export tariffs. |

```ts
await inverter.setMode('timed_demand');
```

The `enableDischarge` snapshot field corresponds to the same register used for mode derivation — in `eco` mode, timed discharge is disabled.

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
