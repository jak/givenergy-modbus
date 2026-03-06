# givenergy-modbus

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

Requires **Node.js 18+**. TypeScript is optional — full type definitions are included.

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

## API documentation

Full API reference is available at **[jak.github.io/givenergy-modbus](https://jak.github.io/givenergy-modbus/)** — auto-generated from source with TypeDoc.

## Protocol note

GivEnergy uses a **non-standard Modbus framing** — the standard Modbus TCP Application Data Unit (MBAP) header is modified with a proprietary wrapper that includes a device serial number, data adapter address, and function codes not found in the Modbus specification. This library implements that framing directly using Node.js `net.Socket`. No external Modbus library is used.
