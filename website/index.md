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
    details: Write any setting in the catalogue, charge/discharge schedules and battery pause, type-checked per layout and gated by model and firmware.
  - title: Auto-discovery
    details: Find GivEnergy inverters on your local network automatically. Identifies the model (Gen1–Gen4 hybrids, AC, All in One, three-phase and more) from the inverter itself.
---

## Install

```bash
npm install givenergy-modbus
```

Requires Node.js 22+. TypeScript types included.

Upgrading from 2.x? See the [migration guide](./migration-v3).

## Quick Example

```ts
import { GivEnergyInverter } from 'givenergy-modbus';

const inverter = await GivEnergyInverter.connect({ host: '192.168.1.100' });

inverter.on('data', (snapshot) => {
  console.log(`Solar: ${snapshot.solar.power}W`);
  console.log(`Battery: ${snapshot.battery.stateOfCharge}%`);
  console.log(`Grid: ${snapshot.grid.power}W`);
});
```
