# Getting Started

## Prerequisites

- **Node.js 20+**
- GivEnergy inverter on your local network (port 8899)
- No other clients connected to port 8899 (e.g. GivTCP) — the data adapter doesn't reliably handle multiple concurrent connections

## Install

```bash
npm install givenergy-modbus
```

TypeScript types are included. No `@types/` package needed.

## Discover Inverters

If you don't know your inverter's IP address, use auto-discovery:

```ts
import { discover } from 'givenergy-modbus';

const devices = await discover();
// [{ host: '192.168.1.100', serialNumber: 'EE1234B567', generation: 'gen3', modelCode: 0x2001 }]
```

Discovery scans your local subnet for devices with port 8899 open, then verifies each candidate with a Modbus probe. You can also specify a subnet:

```ts
const devices = await discover('10.29.0.0/24');
```

For progress reporting (e.g. a pairing UI), use the callbacks:

```ts
const devices = await discover({
  subnet: '10.29.0.0/24',
  onScanProgress(host, portOpen) {
    // Fires after each host is TCP-scanned (Phase 1)
    console.log(`${host}: port ${portOpen ? 'open' : 'closed'}`);
  },
  onFound(device) {
    // Fires when a host is verified as a GivEnergy inverter (Phase 2)
    console.log(`Found ${device.serialNumber} at ${device.host}`);
  },
});
```

## Identify

If you just need to know what's at a given IP — without starting a full polling session — use `identify()`:

```ts
import { GivEnergyInverter } from 'givenergy-modbus';

const identity = await GivEnergyInverter.identify({ host: '192.168.1.100' });
console.log(identity.serialNumber); // e.g. "SD2227G895"
console.log(identity.generation);   // "gen2", "gen3", or "three_phase"
console.log(identity.modelCode);    // raw device type code
```

This reads a single register block (HR 0–59) and closes the connection immediately. Useful during pairing or discovery when you don't need live data.

## Connect

```ts
import { GivEnergyInverter } from 'givenergy-modbus';

const inverter = await GivEnergyInverter.connect({
  host: '192.168.1.100',
});
```

`connect()` returns a promise that resolves after the first complete register poll. The returned object is a `Gen2Inverter`, `Gen3Inverter`, or `ThreePhaseInverter` depending on what the inverter reports.

## Read Data

Call `getData()` for the latest snapshot:

```ts
const snapshot = inverter.getData();

console.log(snapshot.solarPower);       // watts
console.log(snapshot.stateOfCharge);    // 0-100%
console.log(snapshot.gridPower);        // watts (positive = export)
console.log(snapshot.batteryPower);     // watts (positive = discharge)
console.log(snapshot.ecoMode);          // true | false
console.log(snapshot.timedExport);      // true | false
```

The snapshot is a plain object — see [Concepts](./concepts) for what's in it.

## Listen for Updates

The inverter is polled every ~15 seconds. Subscribe to updates:

```ts
inverter.on('data', (snapshot) => {
  console.log(`Solar: ${snapshot.solarPower}W, Battery: ${snapshot.stateOfCharge}%`);
});

// Connection loss
inverter.on('lost', (err) => {
  console.error('Connection lost:', err.message);
});
```

## Control the Inverter

```ts
// Toggle independent mode settings
await inverter.setEcoMode(true);       // HR(27) — eco mode on/off
await inverter.setTimedExport(true);   // HR(59) — timed export on/off
await inverter.setTimedCharge(true);   // HR(96) — timed charge on/off
await inverter.setTimedDischarge(true); // Gen3 only — sets battery pause mode to pause_discharge

// Configure charge schedule
await inverter.setChargeSlot(1, {
  start: '00:30',
  end: '04:30',
  targetStateOfCharge: 100,  // Gen3 only
});

// Set rates and reserves
await inverter.setChargeRatePercent(100);
await inverter.setDischargeRatePercent(100);
await inverter.setBatteryReserve(4);

// Sync inverter clock to system time
await inverter.syncDateTime();
```

Available methods depend on inverter generation. See the [API Reference](/api/) for the full list per class.

## Stop

Always stop the inverter when you're done:

```ts
await inverter.stop();
```

This closes the TCP connection and stops polling.
