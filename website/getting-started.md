# Getting Started

## Prerequisites

- **Node.js 22+**
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
// [{ host: '192.168.1.100', serialNumber: 'EE1234B567', deviceTypeCode: 0x2001, model: 'hybrid_gen3', layout: 'single_phase' }]
```

Discovery scans your local subnet for devices with port 8899 open, then verifies each candidate with a Modbus probe. Devices this library doesn't support (an Energy Management System, a Gateway or an unknown device type) are left out. You can also specify a subnet:

```ts
const devices = await discover('192.168.1.0/24');
```

For progress reporting (e.g. a pairing UI), use the callbacks:

```ts
const devices = await discover({
  subnet: '192.168.1.0/24',
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
console.log(identity.serialNumber);   // e.g. "FD0000A000"
console.log(identity.model);          // e.g. "hybrid_gen3"
console.log(identity.layout);         // "single_phase" or "three_phase"
console.log(identity.deviceTypeCode); // raw device type code (HR 0)
```

This reads a single register block (HR 0–59) and closes the connection immediately. Useful during pairing or discovery when you don't need live data. It rejects with `UnsupportedDeviceError` for a device this library doesn't support.

## Connect

```ts
import { GivEnergyInverter } from 'givenergy-modbus';

const inverter = await GivEnergyInverter.connect({
  host: '192.168.1.100',
});

console.log(inverter.model);        // e.g. 'hybrid_gen3'
console.log(inverter.layout);       // 'single_phase' or 'three_phase'
console.log(inverter.capabilities); // { tenSlots: true, pauseMode: true, ... }
```

`connect()` returns a promise that resolves after the first complete register poll. The returned object is a `SinglePhaseInverter` or a `ThreePhaseInverter`, depending on the model the inverter reports. See [Concepts](./concepts#models-layouts-and-capabilities) for what `model`, `layout` and `capabilities` mean.

Options:

| Option | Default | Description |
|---|---|---|
| `host` | — | Inverter IP address |
| `port` | `8899` | TCP port |
| `pollIntervalMs` | `15000` | Time between polls |
| `autoReconnect` | `true` | Reconnect after the connection is lost |
| `reconnectBackoffMs` | `5000` | First delay between reconnect attempts |
| `reconnectMaxBackoffMs` | `300000` | Maximum delay between reconnect attempts |

## Read Data

Call `getData()` for the latest snapshot:

```ts
const snapshot = inverter.getData();

console.log(snapshot.solar.power);            // watts
console.log(snapshot.battery.stateOfCharge);  // 0-100%
console.log(snapshot.grid.power);             // watts (positive = export)
console.log(snapshot.battery.power);          // watts (positive = discharge)
console.log(snapshot.settings.ecoMode);       // true | false
console.log(snapshot.settings.dcDischarge);   // true | false
```

The snapshot is a plain object grouped by subsystem — see [Concepts](./concepts) for what's in it.

## Listen for Updates

The inverter is polled every ~15 seconds. Subscribe to updates:

```ts
inverter.on('data', (snapshot) => {
  console.log(`Solar: ${snapshot.solar.power}W, Battery: ${snapshot.battery.stateOfCharge}%`);
});

// Connection loss
inverter.on('lost', (err) => {
  console.error('Connection lost:', err.message);
});
```

Other events: `reconnecting` (attempt, next retry in ms), `reconnected` and `debug` (message).

## Control the Inverter

Settings are written with `setSetting(key, value)`. Each key is one holding register; the [settings reference](./settings) lists them all.

```ts
// Independent toggles
await inverter.setSetting('ecoMode', true);      // HR 27
await inverter.setSetting('dcDischarge', true);  // HR 59 (three-phase HR 1122)
await inverter.setSetting('acCharge', true);     // HR 96 (three-phase HR 1112)

// Limits
await inverter.setSetting('batteryReserve', 4);              // %
await inverter.setSetting('acChargeUpperLimit', 100);        // %
await inverter.setSetting('inverterChargePowerPercent', 100); // 1-100 %

// Charge schedule, slots numbered from 1
await inverter.setChargeSlot(1, { start: '00:30', end: '04:30' });

// Sync inverter clock to system time
await inverter.syncDateTime();
```

The keys above exist on both layouts, so they work on the result of `connect()` as it is. Single-phase-only or three-phase-only settings, and `setBatteryPause`, need the inverter narrowed on `layout` first:

```ts
if (inverter.layout === 'single_phase') {
  await inverter.setSetting('batteryChargeRate', 50); // HR 111

  if (inverter.capabilities.pauseWindow) {
    await inverter.setBatteryPause({ mode: 'discharge', start: '16:00', end: '19:00' });
  }
}
```

Each write is checked before anything is sent:

- `RangeError` or `TypeError` for a value the setting doesn't accept (out of range, unknown name, bad `"HH:MM"` time);
- `UnsupportedSettingError` when the model or firmware doesn't support the setting, for example `exportPriority` on an inverter without the HR 300 block. `inverter.supports(key)` checks this first.

The snapshot shows the new value as soon as the inverter accepts the write.

## Stop

Always stop the inverter when you're done:

```ts
await inverter.stop();
```

This closes the TCP connection and stops polling.
