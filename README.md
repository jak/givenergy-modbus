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

Requires **Node.js 20+**. TypeScript is optional — full type definitions are included.

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

// Connect and auto-detect inverter generation (gen2, gen3, three-phase)
const inverter = await GivEnergyInverter.connect({ host: devices[0].host });

// Listen for data updates (every ~15 seconds)
inverter.on('data', (snapshot) => {
  console.log(`Solar: ${snapshot.solarPower}W`);
  console.log(`Battery: ${snapshot.stateOfCharge}%`);
  console.log(`Grid: ${snapshot.gridPower}W (+ = export)`);
});

// Listen for connection loss
inverter.on('lost', (err) => {
  console.error('Connection lost:', err.message);
});

// Read the latest snapshot at any time
const snapshot = inverter.getData();

// Control the inverter
await inverter.setMode('eco');
await inverter.setChargeSlot(1, { start: '00:30', end: '04:30', targetStateOfCharge: 100 });
await inverter.setChargeRate(2600);
await inverter.syncDateTime();
```

## Library scope

This library is **stateless** — it reads the current inverter state and sends individual register writes, but does not track what it has changed or automatically revert anything. Each method call is a single Modbus transaction: read registers, write a register, or poll for updates.

This means higher-level workflows like "force charge for 2 hours then revert to normal" need to be orchestrated by **your application**, not by this library. The library gives you the building blocks; you decide when and how to use them.

### Orchestrating force charge / force discharge

A common use case is forcing the battery to charge from the grid (e.g. during cheap overnight rates) or discharge to the grid (e.g. during peak export rates). Here's how to build this on top of the library:

#### Force charge

```ts
import { GivEnergyInverter } from 'givenergy-modbus';

const inverter = await GivEnergyInverter.connect({ host: '192.168.1.100' });

// 1. Save the current state so you can restore it later
const before = inverter.getData();
const previousMode = before.mode;
const previousChargeRate = before.chargeRatePercent;

// 2. Enable timed demand mode and set a charge slot covering "now"
await inverter.setMode('timed_demand');
await inverter.setChargeSlot(1, { start: '00:00', end: '23:59', targetStateOfCharge: 100 });

// 3. Your app is responsible for reverting when done — use a timer, cron, etc.
setTimeout(async () => {
  await inverter.setMode(previousMode);
  // Restore original charge slot, rate, etc.
  await inverter.stop();
}, 2 * 60 * 60 * 1000); // 2 hours
```

#### Force discharge

```ts
// 1. Save current state
const before = inverter.getData();

// 2. Set timed export mode with a discharge slot covering "now"
await inverter.setMode('timed_export');
await inverter.setDischargeSlot(1, { start: '00:00', end: '23:59' });

// 3. Revert when done (your app's responsibility)
```

#### Key points

- **Always save state before changing it.** The library doesn't track previous values — snapshot fields like `mode`, `chargeRatePercent`, `batteryReservePercent`, and `chargeSlots` tell you the current config so you can restore it.
- **Your app owns the timer/revert logic.** Whether that's `setTimeout`, a cron job, or a home automation trigger is up to you.
- **Gen3 has `batteryPauseMode`** — an alternative to mode switching. Set it to `'pause_discharge'` to hold charge, or `'pause_charge'` to prevent charging, without changing timeslots.
- **The inverter may take a few seconds to act on register writes.** Poll with `getData()` or listen for `'data'` events to confirm changes took effect.

## API documentation

Full API reference is available at **[jak.github.io/givenergy-modbus](https://jak.github.io/givenergy-modbus/)** — auto-generated from source with TypeDoc.

## Built with this library

- **[givenergy-mqtt](https://github.com/jak/givenergy-mqtt)** — Bridge your inverter data to MQTT with Home Assistant auto-discovery.
- **[GivEnergy for Homey](https://github.com/jak/io.jak.givenergy)** — Homey app for monitoring solar, battery, and grid power, tracking energy in the Homey Energy dashboard, and automating inverter modes and charging schedules.

## Protocol note

GivEnergy uses a **non-standard Modbus framing** — the standard Modbus TCP Application Data Unit (MBAP) header is modified with a proprietary wrapper that includes a device serial number, data adapter address, and function codes not found in the Modbus specification. This library implements that framing directly using Node.js `net.Socket`. No external Modbus library is used.
