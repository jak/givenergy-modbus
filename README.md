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

const inverter = new GivEnergyInverter({ host: devices[0].host });

// Listen for data updates (every ~15 seconds)
inverter.on('data', snapshot => {
  console.log(`Solar: ${snapshot.solarPower}W`);
  console.log(`Battery: ${snapshot.stateOfCharge}%`);
  console.log(`Grid: ${snapshot.gridPower}W (+ = export)`);
});

// Listen for connection loss
inverter.on('lost', err => {
  console.error('Connection lost:', err.message);
});

await inverter.start();

// Read the latest snapshot at any time
const snapshot = inverter.getData();
```

## API

### `discover(subnet?): Promise<DiscoveredDevice[]>`

Scans the local network for GivEnergy inverters by probing TCP port 8899.

- `subnet` — optional CIDR string (e.g. `'192.168.1.0/24'`). Auto-detected from the default network interface if omitted.
- Returns an array of `{ host: string }` objects.

### `GivEnergyInverter`

```ts
new GivEnergyInverter(options: GivEnergyInverterOptions)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `host` | `string` | required | Inverter IP address |
| `port` | `number` | `8899` | Modbus TCP port |
| `pollIntervalMs` | `number` | `15000` | Fast poll interval (ms) |

**Events**

| Event | Payload | Description |
|---|---|---|
| `data` | `InverterSnapshot` | Emitted after each successful poll |
| `lost` | `Error` | Emitted when the connection is lost after retries |

**Methods**

| Method | Description |
|---|---|
| `start(): Promise<void>` | Connect and begin polling |
| `stop(): Promise<void>` | Stop polling and disconnect |
| `getData(): InverterSnapshot` | Return the most recent snapshot |
| `setChargeSlot(slot, config): Promise<void>` | Set charge time slot (slot: `1\|2`, config: `{ start, end, targetStateOfCharge? }`) |
| `setDischargeSlot(slot, config): Promise<void>` | Set discharge time slot (slot: `1\|2`, config: `{ start, end }`) |
| `setMode(mode): Promise<void>` | Set operating mode: `'normal'`, `'eco'`, `'grid_charge'`, `'battery_discharge'` |
| `setTargetStateOfCharge(percent): Promise<void>` | Set charge target SOC (0–100) |

Time strings use `"HH:MM"` format, e.g. `"04:30"`.

### `InverterSnapshot`

Snapshot of inverter state at a point in time. All GivEnergy protocol quirks (validation, scaling, signed integers) have been applied.

**Identity**
| Field | Type | Description |
|---|---|---|
| `serialNumber` | `string` | 10-character inverter serial |
| `modelCode` | `number` | Raw device type code |

**Real-time power (watts)**
| Field | Type | Description |
|---|---|---|
| `solarPower` | `number` | Total PV generation |
| `batteryPower` | `number` | Battery power (+ charging, − discharging) |
| `gridPower` | `number` | Grid power (+ export, − import) |
| `loadPower` | `number` | House load demand |

**Battery state**
| Field | Type | Description |
|---|---|---|
| `stateOfCharge` | `number` | Battery SOC % (0–100) |
| `batteryVoltage` | `number` | Battery voltage (V) |
| `batteryCurrent` | `number` | Battery current (A) |

**Grid**
| Field | Type | Description |
|---|---|---|
| `gridVoltage` | `number` | AC grid voltage (V) |
| `gridFrequency` | `number` | AC grid frequency (Hz) |

**Energy totals (kWh)**
| Field | Type | Description |
|---|---|---|
| `pvEnergyTotalKwh` | `number` | Lifetime PV generation |
| `batteryChargeEnergyTotalKwh` | `number` | Lifetime battery charge |
| `batteryDischargeEnergyTotalKwh` | `number` | Lifetime battery discharge |
| `gridImportEnergyTotalKwh` | `number` | Lifetime grid import |
| `gridExportEnergyTotalKwh` | `number` | Lifetime grid export |

**Configuration**
| Field | Type | Description |
|---|---|---|
| `chargeSlot1` | `TimeSlot` | Charge time slot 1 |
| `dischargeSlot1` | `TimeSlot` | Discharge time slot 1 |
| `enableCharge` | `boolean` | Charge enabled flag |
| `enableDischarge` | `boolean` | Discharge enabled flag |
| `chargeTargetStateOfCharge` | `number` | Charge target SOC % |
| `systemTime` | `Date` | Inverter clock |
| `powerFlows` | `PowerFlows` | Derived power flow directions |
| `batteries` | `BatterySnapshot[]` | Attached battery modules |

Each `BatterySnapshot` includes `serialNumber`, `stateOfCharge`, `voltage`, `current`, `temperatureMax`, `temperatureMin`, `cycleCount`, and 16 `cellVoltages`.

## Protocol note

GivEnergy uses a **non-standard Modbus framing** — the standard Modbus TCP Application Data Unit (MBAP) header is modified with a proprietary wrapper that includes a device serial number, data adapter address, and function codes not found in the Modbus specification. This library implements that framing directly using Node.js `net.Socket`. No external Modbus library is used.
