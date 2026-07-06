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

Requires Node.js 22+. TypeScript types included.

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
