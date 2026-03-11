# Documentation Site Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the TypeDoc-only API reference with a full VitePress documentation site including homepage, guides, cookbook, and protocol internals — with TypeDoc API reference integrated as a section.

**Architecture:** VitePress static site generator with `typedoc-plugin-markdown` and `typedoc-vitepress-theme` for API reference integration. TypeDoc runs first to generate markdown + sidebar JSON, then VitePress builds the full site. Source lives in `website/`, built output is gitignored.

**Tech Stack:** VitePress, typedoc-plugin-markdown, typedoc-vitepress-theme

---

### Task 1: Install dependencies and update scripts

**Files:**
- Modify: `package.json`

**Step 1: Install VitePress and TypeDoc integration plugins**

Run:
```bash
npm install -D vitepress typedoc-plugin-markdown typedoc-vitepress-theme
```

**Step 2: Update package.json scripts**

Change the `docs` script and add `docs:dev`:

```json
"docs": "typedoc && vitepress build website",
"docs:dev": "typedoc && vitepress dev website"
```

**Step 3: Verify packages installed**

Run: `npm ls vitepress typedoc-plugin-markdown typedoc-vitepress-theme`
Expected: all three listed without errors

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitepress and typedoc markdown plugin dependencies"
```

---

### Task 2: Update TypeDoc config and gitignore

**Files:**
- Modify: `typedoc.json`
- Modify: `.gitignore`

**Step 1: Update typedoc.json**

Replace the entire file with:

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": ["src/index.ts"],
  "out": "website/api",
  "plugin": ["typedoc-plugin-markdown", "typedoc-vitepress-theme"],
  "docsRoot": "./website",
  "excludePrivate": true,
  "excludeInternal": true,
  "gitRemote": "origin"
}
```

Key changes:
- `out` → `website/api` (markdown into VitePress source tree)
- `plugin` → adds markdown + vitepress theme plugins
- `docsRoot` → `./website` (tells plugin where VitePress root is)

**Step 2: Update .gitignore**

Add these entries:

```
website/api/
website/.vitepress/cache/
website/.vitepress/dist/
```

Remove the existing `docs/` entry — the `docs/` directory now only contains the `plans/` subdirectory (committed) and no longer has generated HTML. The generated site goes to `website/.vitepress/dist/`.

Actually, keep `docs/` in gitignore if you want, but note the `docs/plans/` directory IS committed. Better approach: remove `docs/` from gitignore and instead don't generate anything there anymore. The old generated HTML files in `docs/` (index.html, assets/, classes/, etc.) should be deleted since they're no longer generated there.

Replace the `.gitignore` with:

```
node_modules/
dist/
dumps/
.worktrees/
website/api/
website/.vitepress/cache/
website/.vitepress/dist/
```

**Step 3: Delete old generated docs HTML**

The old TypeDoc HTML output in `docs/` needs to be removed. Keep only `docs/plans/`.

Run:
```bash
rm -f docs/.nojekyll docs/index.html docs/modules.html docs/hierarchy.html
rm -rf docs/assets docs/classes docs/interfaces docs/types docs/functions
```

**Step 4: Run TypeDoc to verify markdown generation**

Run: `npx typedoc`
Expected: generates markdown files in `website/api/` including `typedoc-sidebar.json`

**Step 5: Commit**

```bash
git add typedoc.json .gitignore
git rm -r --cached docs/assets docs/classes docs/interfaces docs/types docs/functions docs/index.html docs/modules.html docs/hierarchy.html docs/.nojekyll 2>/dev/null || true
git add docs/plans/
git commit -m "chore: configure typedoc for markdown output into website/api"
```

---

### Task 3: Create VitePress config

**Files:**
- Create: `website/.vitepress/config.ts`

**Step 1: Create the VitePress config file**

```ts
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'givenergy-modbus',
  description: 'Native Node.js client for GivEnergy inverters over Modbus TCP',
  base: '/givenergy-modbus/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/givenergy-modbus/favicon.svg' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Concepts', link: '/concepts' },
      { text: 'Cookbook', link: '/cookbook' },
      { text: 'Protocol', link: '/protocol' },
      { text: 'API Reference', link: '/api/' },
    ],

    sidebar: {
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/getting-started' },
            { text: 'Concepts', link: '/concepts' },
            { text: 'Cookbook', link: '/cookbook' },
            { text: 'Protocol Internals', link: '/protocol' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [{ text: 'Back to Guide', link: '/getting-started' }],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/jak/givenergy-modbus' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/givenergy-modbus' },
    ],

    editLink: {
      pattern: 'https://github.com/jak/givenergy-modbus/edit/main/website/:path',
    },

    search: {
      provider: 'local',
    },
  },
});
```

Note: The `typedoc-vitepress-theme` plugin automatically injects the API sidebar items from `typedoc-sidebar.json` when the VitePress theme is loaded. If it doesn't work automatically, we'll import the sidebar JSON and merge it in Task 2's verification step. Check the generated `website/api/typedoc-sidebar.json` after running typedoc.

**Step 2: Verify VitePress can start**

Run: `npx typedoc && npx vitepress dev website`
Expected: dev server starts. Press Ctrl+C to stop.

**Step 3: Commit**

```bash
git add website/.vitepress/config.ts
git commit -m "chore: add vitepress config with nav, sidebar, and search"
```

---

### Task 4: Create homepage

**Files:**
- Create: `website/index.md`

**Step 1: Create the homepage**

```markdown
---
layout: home

hero:
  name: givenergy-modbus
  text: GivEnergy Inverter Client
  tagline: Native Node.js library for local Modbus TCP communication — no cloud required
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: API Reference
      link: /api/

features:
  - title: Real-time Monitoring
    details: Poll solar, battery, and grid power every 15 seconds with automatic push-mode data collection from the inverter.
  - title: Inverter Control
    details: Set operating modes, charge/discharge schedules, battery reserves, and rate limits with type-safe methods per generation.
  - title: Auto-discovery
    details: Find GivEnergy inverters on your local network automatically. Detects Gen2, Gen3, and three-phase models.
---

## Install

```bash
npm install givenergy-modbus
```

Requires Node.js 20+. TypeScript types included.

## Quick Example

```ts
import { GivEnergyInverter } from 'givenergy-modbus';

const inverter = await GivEnergyInverter.connect({ host: '192.168.1.100' });

inverter.on('data', (snapshot) => {
  console.log(`Solar: ${snapshot.solarPower}W`);
  console.log(`Battery: ${snapshot.stateOfCharge}%`);
  console.log(`Grid: ${snapshot.gridPower}W`);
});
```
```

**Step 2: Verify homepage renders**

Run: `npx vitepress dev website`
Expected: homepage shows hero, features, install block, and code example

**Step 3: Commit**

```bash
git add website/index.md
git commit -m "docs: add homepage with hero, features, and quick example"
```

---

### Task 5: Create Getting Started page

**Files:**
- Create: `website/getting-started.md`

**Step 1: Write the getting started guide**

```markdown
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
// [{ host: '192.168.1.100', serialNumber: 'EE1234B567' }]
```

Discovery sends a UDP broadcast and listens for responses. You can also specify a subnet:

```ts
const devices = await discover('10.29.0.0/24');
```

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
console.log(snapshot.mode);             // 'eco' | 'timed_demand' | 'timed_export'
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
// Set operating mode
await inverter.setMode('eco');
await inverter.setMode('timed_demand');
await inverter.setMode('timed_export');

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
```

**Step 2: Verify page renders**

Run: `npx vitepress dev website`, navigate to Getting Started
Expected: page renders with all sections and code blocks

**Step 3: Commit**

```bash
git add website/getting-started.md
git commit -m "docs: add getting started guide"
```

---

### Task 6: Create Concepts page

**Files:**
- Create: `website/concepts.md`

**Step 1: Write the concepts page**

```markdown
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

Generation detection uses the device type code (HR 0) and ARM firmware version (HR 21). If those registers aren't available, it falls back to serial number prefix detection.

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
```

**Step 2: Verify**

Run: `npx vitepress dev website`, navigate to Concepts
Expected: renders with tables and code blocks

**Step 3: Commit**

```bash
git add website/concepts.md
git commit -m "docs: add concepts page covering snapshots, generations, modes, power flows"
```

---

### Task 7: Create Cookbook page

**Files:**
- Create: `website/cookbook.md`

**Step 1: Write the cookbook**

```markdown
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
```

**Step 2: Verify**

Run: `npx vitepress dev website`, navigate to Cookbook
Expected: renders with tip callouts and code blocks

**Step 3: Commit**

```bash
git add website/cookbook.md
git commit -m "docs: add cookbook with force charge/discharge, monitoring, and pause mode recipes"
```

---

### Task 8: Create Protocol Internals page

**Files:**
- Create: `website/protocol.md`

**Step 1: Write the protocol internals page**

```markdown
# Protocol Internals

Technical details of the GivEnergy Modbus TCP protocol. This page is for contributors and anyone debugging inverter communication.

## Frame Format

GivEnergy uses a non-standard Modbus TCP framing. A standard Modbus TCP frame has a 7-byte MBAP header; GivEnergy wraps the inner Modbus PDU in a proprietary "transparent" frame:

```
Bytes 0-1:    Transaction ID (always 0x5959)
Bytes 2-3:    Protocol ID (always 0x0001)
Bytes 4-5:    Length (of everything after this field)
Byte 6:       Unit ID (always 0x01)
Byte 7:       Function ID (0x02 = transparent message)
Bytes 8-17:   Data adapter serial number (10 bytes, Latin-1)
Bytes 18-25:  Padding (see below)
Byte 26:      Slave address
Byte 27:      Inner function code
Bytes 28+:    Inner payload (register data)
Last 2 bytes: CRC-16/Modbus of bytes 26 onwards
```

### The Padding Field

The 8-byte padding field at bytes 18-25 is a **big-endian 64-bit integer with value 8**:

```
00 00 00 00 00 00 00 08
```

This is a common source of bugs — it looks like it could be `08 00 00 00 00 00 00 00` (little-endian), but the GivEnergy data adapter expects big-endian. Getting this wrong causes the adapter to silently drop the frame.

### No Trailing Null

Unlike some Modbus implementations, GivEnergy frames do **not** include a trailing null byte after the CRC. The frame ends immediately after the 2-byte CRC.

## Slave Addresses

| Address | Device |
|---------|--------|
| `0x11` | Inverter (single-phase Gen2/Gen3) |
| `0x31` | Inverter (AC/Gen1 — detected via HR(0)) |
| `0x32`–`0x37` | LV battery modules (up to 6) |
| `0x70`+ | HV BCU (Battery Control Unit) |
| `0x01`–`0x08` | CT meters |

## Inner Function Codes

| Code | Operation |
|------|-----------|
| `0x03` | Read holding registers |
| `0x04` | Read input registers |
| `0x06` | Write single holding register |
| `0x16` (22) | Read meter product registers |

## Register Layout

Registers are 16-bit unsigned values. The inverter supports two types:

- **Input registers (IR)** — read-only sensor data, power readings, energy totals
- **Holding registers (HR)** — read-write configuration, timeslots, enable flags

### Request Alignment

Each read request can fetch up to **60 registers** and the base address must be **60-aligned** (0, 60, 120, 180, ...). Requesting an unaligned base or more than 60 registers causes the inverter to return an error or garbage data.

### Key Register Blocks

**Input registers:**

| Base | Contents |
|------|----------|
| IR 0–59 | Power readings, PV data, battery state, grid measurements |
| IR 60–119 | Battery module data (cell voltages, temperatures) |
| IR 120–179 | (Reserved) |
| IR 180–239 | Energy totals (charge total, discharge total) |

**Holding registers:**

| Base | Contents |
|------|----------|
| HR 0–59 | Identity, system time, device type, mode flags, discharge slots |
| HR 60–119 | Charge slots, enable flags, charge target SOC, battery reserve |
| HR 120–179 | Firmware versions, additional config |
| HR 180–239 | Discharge energy total, additional settings |
| HR 240–359 | Gen3 extended registers (charge/discharge rates, pause mode) |
| HR 1080–1139 | Three-phase specific registers (rates, reserves, timeslots) |
| HR 4080–4139 | 32-bit battery energy totals (newer firmware) |

## Scaling Conventions

Raw register values need scaling before use:

| Function | Operation | Example |
|----------|-----------|---------|
| `toDeci` | ÷ 10 | IR(5) = 2320 → 232.0 V |
| `toCenti` | ÷ 100 | IR(50) = 4800 → 48.00 V |
| `toMilli` | ÷ 1000 | IR(80) = 3200 → 3.200 V |
| `toInt16` | Signed interpretation | IR(52) = 0xFFCE → -50 W |
| `toUint32` | Two registers → 32-bit | IR(11,12) → total energy |

## Heartbeat and Push Mode

The GivEnergy data adapter (the WiFi/Ethernet module attached to the inverter) has a heartbeat mechanism:

1. The adapter sends a heartbeat frame every ~3 minutes
2. The client must respond within 5 seconds or the adapter drops the connection
3. After the client responds to any request, the inverter enters **push mode** — it sends all register data in 60-register chunks without being asked

The library handles heartbeats automatically. Push mode data is accumulated by the poll manager alongside explicit register reads.

## Data Adapter Quirks

### Single Client

The data adapter does **not** reliably handle multiple concurrent TCP connections on port 8899. If two clients connect simultaneously, responses may be routed to the wrong client, causing timeouts and corrupted data in both.

### Response Routing

The data adapter uses the transaction ID to route responses back to the requesting client. Since the library uses a fixed TID (0x5959), there's no multiplexing — one request at a time.

### Empty Serial on Bad Connection

If the inverter returns an empty serial number in the first poll, the connection is likely unreliable. The library rejects this and throws during `connect()`.

## Device Type Detection

The inverter generation is detected from two holding registers:

1. **HR(0)** — device type code (e.g. `0x2001` = hybrid)
2. **HR(21)** — ARM firmware version (e.g. 300 = Gen3)

The `detectModel()` function combines these to determine the exact model. If HR(0) is 0 (not yet read), the library falls back to serial number prefix detection — but this is unreliable as many serial prefixes (like "FD" for Gen3) aren't in the prefix map.

| Prefix | Generation |
|--------|-----------|
| CE | Gen2 |
| EE | Gen3 |
| SA | Three-phase |
```

**Step 2: Verify**

Run: `npx vitepress dev website`, navigate to Protocol Internals
Expected: renders with tables and code blocks

**Step 3: Commit**

```bash
git add website/protocol.md
git commit -m "docs: add protocol internals page covering frame format, registers, heartbeat"
```

---

### Task 9: Update CI workflow

**Files:**
- Modify: `.github/workflows/docs.yml`

**Step 1: Update the docs workflow**

Replace the entire file:

```yaml
name: Deploy docs to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run docs
      - uses: actions/upload-pages-artifact@v3
        with:
          path: website/.vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

The only change from before is the artifact path: `docs` → `website/.vitepress/dist`.

**Step 2: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "ci: update docs workflow to build vitepress site"
```

---

### Task 10: Verify full build and local preview

**Step 1: Run full docs build**

Run: `npm run docs`
Expected: TypeDoc generates markdown in `website/api/`, VitePress builds static site to `website/.vitepress/dist/`

**Step 2: Preview the built site**

Run: `npx vitepress preview website`
Expected: site loads at localhost, homepage renders with hero, all nav links work, API reference pages load

**Step 3: Verify API sidebar integration**

Navigate to the API Reference section. Confirm that TypeDoc-generated pages (classes, interfaces, types, functions) appear in the sidebar and render correctly.

**Step 4: Check for broken links**

Click through all nav items and sidebar links. Verify:
- Homepage → Getting Started button works
- Homepage → API Reference button works
- All sidebar links resolve
- Code blocks render with syntax highlighting
- Tables render correctly

**Step 5: If anything is broken, fix it**

Common issues:
- Sidebar JSON import path wrong in config.ts → check `website/api/typedoc-sidebar.json` exists after `npx typedoc`
- Base path wrong → check links work with `/givenergy-modbus/` prefix
- API pages missing → check `typedoc.json` `out` points to `website/api`

**Step 6: Final commit**

If any fixes were needed:
```bash
git add -A
git commit -m "docs: fix vitepress build issues"
```
