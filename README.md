# givenergy-modbus

[![CI](https://github.com/jak/givenergy-modbus/actions/workflows/ci.yml/badge.svg)](https://github.com/jak/givenergy-modbus/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/givenergy-modbus)](https://www.npmjs.com/package/givenergy-modbus)
[![node](https://img.shields.io/node/v/givenergy-modbus)](https://www.npmjs.com/package/givenergy-modbus)
[![license](https://img.shields.io/npm/l/givenergy-modbus)](https://github.com/jak/givenergy-modbus/blob/main/LICENSE)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/jak?label=sponsor)](https://github.com/sponsors/jak)
[![Buy Me a Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-donate-yellow)](https://buymeacoffee.com/jakio)

Native Node.js client for GivEnergy inverters over their proprietary Modbus TCP protocol.

## Attribution

This library would not exist without [giv_tcp](https://github.com/britkat1980/giv_tcp) by britkat1980. The protocol framing, register mappings, validation quirks, and device discovery logic were all ported from that project. giv_tcp is the definitive reference for GivEnergy's undocumented Modbus protocol — if you need a battle-tested solution with a web UI and Home Assistant integration, use that.

## Local connection

This library communicates **directly with the inverter over your local network** (port 8899). No GivEnergy cloud account or internet connection is required. If you prefer to use the official cloud API, GivEnergy provides a REST API — see the GivEnergy developer documentation for details.

> **Do not run this library at the same time as GivTCP** (or any other client connected to port 8899). The GivEnergy data adapter does not reliably handle multiple concurrent TCP connections — responses may be routed to the wrong client, causing timeouts and missing data in both.

## Installation

```bash
npm install givenergy-modbus
```

Requires **Node.js 22+**. TypeScript is optional — full type definitions are included.

## Upgrading from 2.x

3.0 is a breaking release: the snapshot is nested, settings are written with `setSetting`, and
`generation` is replaced by `layout`, `model` and `capabilities`. The
**[migration guide](https://jak.github.io/givenergy-modbus/migration-v3)** maps every 2.x field and
method to its 3.0 equivalent.

## Identify an inverter

If you just need to know what's at a given IP — without starting a full polling session — use `identify()`. It reads a single register block and closes the connection immediately:

```ts
import { GivEnergyInverter } from 'givenergy-modbus';

const identity = await GivEnergyInverter.identify({ host: '192.168.1.100' });
console.log(identity.serialNumber);   // e.g. "FD0000A000"
console.log(identity.model);          // e.g. "hybrid_gen3", "ac", "hybrid_3ph"
console.log(identity.layout);         // "single_phase" or "three_phase"
console.log(identity.deviceTypeCode); // raw device type code from HR 0
```

This is useful during pairing or discovery when you don't need live data. It rejects with `UnsupportedDeviceError` for an Energy Management System, a Gateway or an unknown device.

## Quick start

```ts
import { discover, GivEnergyInverter } from 'givenergy-modbus';

// Find inverters on the local network
const devices = await discover(); // auto-detects subnet
// or: await discover('192.168.1.0/24')

if (devices.length === 0) {
  console.error('No inverters found');
  process.exit(1);
}

// Connect: resolves after the first full poll, with the model already identified
const inverter = await GivEnergyInverter.connect({ host: devices[0].host });
console.log(inverter.model, inverter.layout);

// Listen for data updates (every ~15 seconds)
inverter.on('data', (snapshot) => {
  console.log(`Solar: ${snapshot.solar.power}W`);
  console.log(`Battery: ${snapshot.battery.stateOfCharge}%`);
  console.log(`Grid: ${snapshot.grid.power}W (+ = export)`);
});

// Listen for connection loss
inverter.on('lost', (err) => {
  console.error('Connection lost:', err.message);
});

// Read the latest snapshot at any time
const snapshot = inverter.getData();
console.log(snapshot.settings.ecoMode, snapshot.schedules.charge);

// Control the inverter: settings are independent registers
await inverter.setSetting('ecoMode', true);
await inverter.setSetting('acCharge', true);
await inverter.setChargeSlot(1, { start: '00:30', end: '04:30' });
await inverter.syncDateTime();
```

Every setting `setSetting` accepts, with its registers and the models that support it, is in the **[settings reference](https://jak.github.io/givenergy-modbus/settings)**.

### Layouts and capabilities

`connect()` returns a `SinglePhaseInverter` or a `ThreePhaseInverter`. Settings that exist on both layouts can be written straight away; layout-specific settings and battery pause need narrowing on `layout`, and model- or firmware-specific features are checked with `capabilities`:

```ts
if (inverter.layout === 'single_phase') {
  await inverter.setSetting('batteryChargeRate', 50); // HR 111, single-phase only

  if (inverter.capabilities.perSlotTargets) {
    await inverter.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 100 });
  }
  if (inverter.capabilities.pauseMode) {
    await inverter.setBatteryPause({ mode: 'off' });
  }
}
```

A write the model or firmware doesn't support throws `UnsupportedSettingError`; `inverter.supports(key)` checks a setting first.

## Library scope

This library is **stateless** — it reads the current inverter state and sends individual register writes, but does not track what it has changed or automatically revert anything. Each method call writes one register, or a short run of registers for a slot or battery pause.

This means higher-level workflows like "force charge for 2 hours then revert to normal" need to be orchestrated by **your application**, not by this library. The library gives you the building blocks; you decide when and how to use them.

### Orchestrating force charge / force discharge

A common use case is forcing the battery to charge from the grid (e.g. during cheap overnight rates) or discharge to the grid (e.g. during peak export rates). Here's how to build this on top of the library:

#### Force charge

```ts
import { GivEnergyInverter } from 'givenergy-modbus';

const inverter = await GivEnergyInverter.connect({ host: '192.168.1.100' });

// 1. Save the current state so you can restore it later
const before = inverter.getData();
const [slot1] = before.schedules.charge;

// 2. Enable AC charge and set a charge slot covering "now"
await inverter.setSetting('acCharge', true);
await inverter.setChargeSlot(1, { start: '00:00', end: '23:59' });

// 3. Your app is responsible for reverting when done — use a timer, cron, etc.
setTimeout(async () => {
  await inverter.setSetting('acCharge', before.settings.acCharge);
  if (slot1) await inverter.setChargeSlot(slot1); // the slot entry carries its own number
  await inverter.stop();
}, 2 * 60 * 60 * 1000); // 2 hours
```

#### Force discharge

```ts
// 1. Save current state
const before = inverter.getData();

// 2. Enable DC discharge with a discharge slot covering "now"
await inverter.setSetting('dcDischarge', true);
await inverter.setDischargeSlot(1, { start: '00:00', end: '23:59' });

// 3. Revert when done (your app's responsibility)
await inverter.setSetting('dcDischarge', before.settings.dcDischarge);
```

#### Key points

- **Always save state before changing it.** The library doesn't track previous values — `snapshot.settings` (`ecoMode`, `dcDischarge`, `acCharge`, `batteryReserve`, …) and `snapshot.schedules` tell you the current config so you can restore it.
- **Your app owns the timer/revert logic.** Whether that's `setTimeout`, a cron job, or a home automation trigger is up to you.
- **Settings are independent toggles**, not mutually exclusive modes. Eco mode (HR 27), DC discharge (HR 59) and AC charge (HR 96) can each be toggled without affecting the others. Single-phase models with `capabilities.pauseMode` also have a battery pause (HR 318–320).
- **The inverter may take a few seconds to act on register writes.** The snapshot shows a written setting as soon as the inverter accepts it; listen for `'data'` events to see the inverter's live values respond.

## API documentation

Full API reference is available at **[jak.github.io/givenergy-modbus](https://jak.github.io/givenergy-modbus/)** — auto-generated from source with TypeDoc.

## Built with this library

- **[givenergy-mqtt](https://github.com/jak/givenergy-mqtt)** — Bridge your inverter data to MQTT with Home Assistant auto-discovery.
- **[GivEnergy for Homey](https://github.com/jak/io.jak.givenergy)** — Homey app for monitoring solar, battery, and grid power, tracking energy in the Homey Energy dashboard, and automating inverter modes and charging schedules.

## Protocol note

GivEnergy uses a **non-standard Modbus framing** — the standard Modbus TCP Application Data Unit (MBAP) header is modified with a proprietary wrapper that includes a device serial number, data adapter address, and function codes not found in the Modbus specification. This library implements that framing directly using Node.js `net.Socket`. No external Modbus library is used.
