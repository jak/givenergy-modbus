# HV Battery Scanning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement BAMS → BCU → BMU battery scanning for HV (high-voltage) inverter systems, fixing #5.

**Architecture:** When `isHighVoltage()` is true, PollManager reads BAMS (0xA0) to discover BCU count, reads each BCU (0x70+) for pack-level data and module counts, then reads each BMU (0x50+) for per-module cell data. BMU data populates `BatterySnapshot[]` with a new `stack` field indicating BCU membership. BCU aggregate data (energy totals) feeds into inverter-level battery totals.

**Tech Stack:** TypeScript, Vitest, Modbus TCP

---

### Task 1: Add `stack` field to BatterySnapshot

**Files:**
- Modify: `src/model/battery-snapshot.ts:15-52`
- Test: `test/snapshot-builder.test.ts`

**Step 1: Write the failing test**

Add to `test/snapshot-builder.test.ts` in the `buildBatterySnapshot` describe block:

```typescript
it('LV battery snapshots have no stack field by default', () => {
  const bat = buildBatterySnapshot(makeBatteryCache());
  expect(bat!.stack).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/snapshot-builder.test.ts --reporter=verbose`
Expected: FAIL — `stack` property not on type

**Step 3: Add optional `stack` field to BatterySnapshot**

In `src/model/battery-snapshot.ts`, add after `cellVoltages`:

```typescript
/**
 * HV battery stack index — identifies which BCU (Battery Control Unit) this
 * module belongs to. Present only for HV systems; undefined for LV batteries.
 * Modules with the same stack value belong to the same physical battery pack.
 */
stack?: number;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/snapshot-builder.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/model/battery-snapshot.ts test/snapshot-builder.test.ts
git commit -m "feat: add optional stack field to BatterySnapshot for HV systems

Fixes #5. HV (high-voltage) battery systems have a hierarchy: multiple
battery modules (BMUs) belong to a stack controlled by a BCU. The stack
field identifies which BCU a module belongs to."
```

---

### Task 2: Add HV battery constants and BAMS/BCU/BMU slave addresses

**Files:**
- Modify: `src/poll-manager.ts:22-30`
- Test: (no test needed — constants only)

**Step 1: Add constants to poll-manager.ts**

After the existing `LV_BATTERY_SLAVES` and `METER_SLAVES` constants (line 26):

```typescript
/** BAMS (Battery Aggregation & Management System) slave address — reports BCU count */
const BAMS_SLAVE = 0xa0;
/** BAMS register containing number of BCUs */
const BAMS_NUMBER_OF_BCUS_REGISTER = 61;
/** BCU (Battery Control Unit) base slave address — BCU N is at 0x70 + N */
const BCU_BASE_SLAVE = 0x70;
/** BCU register containing number of BMUs (modules) in this BCU */
const BCU_NUMBER_OF_MODULES_REGISTER = 64;
/** BMU (Battery Module Unit) base slave address — BMU N is at 0x50 + N */
const BMU_BASE_SLAVE = 0x50;
/** BMU register read count — 60 registers per module */
const BMU_REGISTER_COUNT = 60;
/** BMU base register offset multiplier — each BCU adds 120 to the base */
const BMU_BCU_OFFSET = 120;
```

**Step 2: Commit**

```bash
git add src/poll-manager.ts
git commit -m "feat: add BAMS, BCU, and BMU slave address constants

Fixes #5. BAMS at 0xA0 reports BCU count, BCUs at 0x70+ report
module counts, BMUs at 0x50+ provide per-module cell data."
```

---

### Task 3: Build BMU snapshot function

**Files:**
- Modify: `src/snapshot-builder.ts`
- Test: `test/snapshot-builder.test.ts`

BMU registers (all relative to base, which includes BCU offset):
- Cell voltages: IR(60-83) — 24 cells via toMilli
- Cell temperatures: IR(90-113) — 24 cells via toDeci
- Serial number: IR(114-118) — 5 registers

**Step 1: Write failing tests**

Add a new describe block to `test/snapshot-builder.test.ts`:

```typescript
describe('buildBmuSnapshot', () => {
  function makeBmuCache(): Map<number, number> {
    const m = new Map<number, number>();
    // Serial number: IR(114-118) = 'HV12345678'
    // Note: BMU serial is at IR(114-118), not IR(110-114) like LV batteries
    const serial = 'HV12345678';
    for (let i = 0; i < 5; i++) {
      m.set(114 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
    }
    // 24 cell voltages: IR(60-83) = 3300 → toMilli = 3.3V
    for (let i = 0; i < 24; i++) {
      m.set(60 + i, 3300);
    }
    // 24 cell temperatures: IR(90-113) = 250 → toDeci = 25.0°C
    for (let i = 0; i < 24; i++) {
      m.set(90 + i, 250);
    }
    return m;
  }

  it('decodes BMU serial number from IR(114-118), not IR(110-114)', () => {
    // BMU serial registers are at a different offset than LV battery serial.
    // LV: IR(110-114), BMU: IR(114-118). This is a real protocol difference.
    const bmu = buildBmuSnapshot(makeBmuCache(), 0);
    expect(bmu).not.toBeNull();
    expect(bmu!.serialNumber).toBe('HV12345678');
  });

  it('decodes 24 cell voltages via toMilli (vs 16 for LV)', () => {
    // HV battery modules have 24 cells per module, unlike LV which has 16.
    const bmu = buildBmuSnapshot(makeBmuCache(), 0);
    expect(bmu!.cellVoltages).toHaveLength(24);
    expect(bmu!.cellVoltages[0]).toBeCloseTo(3.3, 2);
    expect(bmu!.cellVoltages[23]).toBeCloseTo(3.3, 2);
  });

  it('derives temperatureMax and temperatureMin from 24 cell temperatures', () => {
    // BMU provides individual cell temperatures; we derive min/max for the snapshot.
    const cache = makeBmuCache();
    cache.set(90, 280);  // cell 1: 28.0°C (hottest)
    cache.set(91, 220);  // cell 2: 22.0°C (coolest)
    const bmu = buildBmuSnapshot(cache, 0);
    expect(bmu!.temperatureMax).toBeCloseTo(28.0, 1);
    expect(bmu!.temperatureMin).toBeCloseTo(22.0, 1);
  });

  it('sets stack field to the provided BCU index', () => {
    const bmu = buildBmuSnapshot(makeBmuCache(), 2);
    expect(bmu!.stack).toBe(2);
  });

  it('returns null when all serial registers are zero (no module present)', () => {
    const cache = new Map<number, number>();
    for (let i = 0; i < 5; i++) {
      cache.set(114 + i, 0);
    }
    expect(buildBmuSnapshot(cache, 0)).toBeNull();
  });

  it('sets SOC, voltage, energy totals, and cycle count to 0 (BCU provides these)', () => {
    // BMU modules only report cell-level data. Pack-level aggregate data
    // (SOC, voltage, energy totals) comes from the BCU and is populated
    // separately via populateBcuData().
    const bmu = buildBmuSnapshot(makeBmuCache(), 0);
    expect(bmu!.stateOfCharge).toBe(0);
    expect(bmu!.voltage).toBe(0);
    expect(bmu!.chargeEnergyTotalKwh).toBe(0);
    expect(bmu!.dischargeEnergyTotalKwh).toBe(0);
    expect(bmu!.cycleCount).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/snapshot-builder.test.ts --reporter=verbose`
Expected: FAIL — `buildBmuSnapshot` not found

**Step 3: Implement buildBmuSnapshot**

Add to `src/snapshot-builder.ts` after `buildBatterySnapshot`:

```typescript
/**
 * Build a BatterySnapshot from a single BMU (Battery Module Unit) register cache.
 *
 * BMU modules in HV systems report per-cell data (24 cells) but not pack-level
 * aggregates (SOC, voltage, energy totals) — those come from the BCU.
 *
 * Register layout differences from LV batteries:
 *  - 24 cell voltages at IR(60-83) instead of 16 at IR(60-75)
 *  - 24 cell temperatures at IR(90-113) — LV batteries don't have per-cell temps
 *  - Serial at IR(114-118) instead of IR(110-114)
 *
 * Returns null if serial registers are all zero (no module at this address).
 */
export function buildBmuSnapshot(
  irCache: Map<number, number>,
  bcuIndex: number,
): BatterySnapshot | null {
  function get(address: number): number {
    return irCache.get(address) ?? 0;
  }

  // serial_number: IR(114-118) — 5 registers, 10-char ASCII
  const serialRegs = [114, 115, 116, 117, 118].map(a => get(a));
  const isAllNull = serialRegs.every(r => r === 0);
  if (isAllNull) {
    return null;
  }
  const serialNumber = registersToString(serialRegs);

  // 24 cell voltages: IR(60-83) via toMilli → V
  const cellVoltages: number[] = [];
  for (let i = 0; i < 24; i++) {
    cellVoltages.push(toMilli(get(60 + i)));
  }

  // 24 cell temperatures: IR(90-113) via toDeci → °C
  // Derive min/max for the BatterySnapshot interface
  const cellTemps: number[] = [];
  for (let i = 0; i < 24; i++) {
    cellTemps.push(toDeci(get(90 + i)));
  }
  const temperatureMax = Math.max(...cellTemps);
  const temperatureMin = Math.min(...cellTemps);

  return {
    serialNumber,
    stateOfCharge: 0,
    voltage: 0,
    dischargeEnergyTotalKwh: 0,
    chargeEnergyTotalKwh: 0,
    temperatureMax,
    temperatureMin,
    cycleCount: 0,
    cellVoltages,
    stack: bcuIndex,
  };
}
```

Also add `buildBmuSnapshot` to the import in `test/snapshot-builder.test.ts`:

```typescript
import { buildSnapshot, buildBatterySnapshot, buildBmuSnapshot, buildMeterSnapshot, type RegisterCache } from '../src/snapshot-builder.js';
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/snapshot-builder.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/snapshot-builder.ts test/snapshot-builder.test.ts
git commit -m "feat: add buildBmuSnapshot for HV battery module data

Fixes #5. BMU (Battery Module Unit) provides 24 cell voltages and
24 cell temperatures per module. Pack-level data (SOC, voltage,
energy totals) comes from the BCU, not the individual modules."
```

---

### Task 4: Add BCU data population function

**Files:**
- Modify: `src/snapshot-builder.ts`
- Test: `test/snapshot-builder.test.ts`

BCU register layout (IR, slave 0x70+N, base=60):
- IR(64): number_of_modules
- IR(73): battery_voltage → toDeci
- IR(76): battery_current → toInt16 then toDeci
- IR(79): battery_power → toMilli (÷1000, watts)
- IR(80): battery_soc_max (upper byte) / battery_soc_min (lower byte)
- IR(81): battery_soh
- IR(82-83): charge_energy_total → uint32 then toDeci
- IR(84-85): discharge_energy_total → uint32 then toDeci
- IR(100): number_of_cycles → toDeci

**Step 1: Write failing tests**

Add to `test/snapshot-builder.test.ts`:

```typescript
describe('parseBcuData', () => {
  function makeBcuCache(): Map<number, number> {
    const m = new Map<number, number>();
    m.set(64, 3);      // number_of_modules: 3 BMUs
    m.set(73, 3840);   // battery_voltage: 3840 → toDeci = 384.0V
    m.set(76, 50);     // battery_current: 50 → toInt16→toDeci = 5.0A
    m.set(79, 1920);   // battery_power: 1920 → toMilli = 1.92kW = 1920W
    m.set(80, (95 << 8) | 90);  // soc_max=95, soc_min=90
    m.set(81, 98);     // battery_soh: 98%
    m.set(82, 0);      // charge_energy_total high
    m.set(83, 5000);   // charge_energy_total low → uint32→toDeci = 500.0 kWh
    m.set(84, 0);      // discharge_energy_total high
    m.set(85, 4500);   // discharge_energy_total low → uint32→toDeci = 450.0 kWh
    m.set(100, 150);   // number_of_cycles: 150 → toDeci = 15.0
    return m;
  }

  it('parses module count from IR(64)', () => {
    const bcu = parseBcuData(makeBcuCache());
    expect(bcu.numberOfModules).toBe(3);
  });

  it('parses charge and discharge energy totals as uint32 toDeci', () => {
    const bcu = parseBcuData(makeBcuCache());
    expect(bcu.chargeEnergyTotalKwh).toBeCloseTo(500.0, 1);
    expect(bcu.dischargeEnergyTotalKwh).toBeCloseTo(450.0, 1);
  });

  it('extracts SOC max from upper byte and SOC min from lower byte of IR(80)', () => {
    // IR(80) packs two 8-bit values: upper byte = soc_max, lower byte = soc_min.
    // This is a GivEnergy protocol quirk for HV systems.
    const bcu = parseBcuData(makeBcuCache());
    expect(bcu.stateOfChargeMax).toBe(95);
    expect(bcu.stateOfChargeMin).toBe(90);
  });

  it('parses cycle count via toDeci', () => {
    const bcu = parseBcuData(makeBcuCache());
    expect(bcu.cycleCount).toBeCloseTo(15.0, 1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/snapshot-builder.test.ts --reporter=verbose`
Expected: FAIL — `parseBcuData` not found

**Step 3: Implement parseBcuData**

Add type and function to `src/snapshot-builder.ts`:

```typescript
/** Parsed BCU (Battery Control Unit) pack-level data */
export interface BcuData {
  numberOfModules: number;
  voltage: number;
  current: number;
  power: number;
  stateOfChargeMax: number;
  stateOfChargeMin: number;
  stateOfHealth: number;
  chargeEnergyTotalKwh: number;
  dischargeEnergyTotalKwh: number;
  cycleCount: number;
}

/**
 * Parse BCU (Battery Control Unit) register data into structured form.
 *
 * BCU provides pack-level aggregate data for an HV battery stack.
 * Individual module data comes from BMU reads.
 */
export function parseBcuData(irCache: Map<number, number>): BcuData {
  function get(address: number): number {
    return irCache.get(address) ?? 0;
  }

  const socRegister = get(80);

  return {
    numberOfModules: get(64),
    voltage: toDeci(get(73)),
    current: toDeci(toInt16(get(76))),
    power: toMilli(get(79)),
    stateOfChargeMax: (socRegister >> 8) & 0xff,
    stateOfChargeMin: socRegister & 0xff,
    stateOfHealth: get(81),
    chargeEnergyTotalKwh: toDeci(toUint32(get(82), get(83))),
    dischargeEnergyTotalKwh: toDeci(toUint32(get(84), get(85))),
    cycleCount: toDeci(get(100)),
  };
}
```

Update the test import:

```typescript
import { buildSnapshot, buildBatterySnapshot, buildBmuSnapshot, parseBcuData, buildMeterSnapshot, type RegisterCache } from '../src/snapshot-builder.js';
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/snapshot-builder.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/snapshot-builder.ts test/snapshot-builder.test.ts
git commit -m "feat: add parseBcuData for HV battery pack-level data

Fixes #5. BCU (Battery Control Unit) provides aggregate pack data:
voltage, current, SOC, energy totals, and the number of BMU modules
in the stack."
```

---

### Task 5: Add HV scanning to PollManager

**Files:**
- Modify: `src/poll-manager.ts`
- Modify: `src/snapshot-builder.ts` (pass `isHighVoltage` through to buildSnapshot)
- Test: `test/poll-manager.test.ts`

**Step 1: Write failing test**

Add to `test/poll-manager.test.ts`:

```typescript
it('stores device type after first successful poll for HV detection', () => {
  // PollManager needs to know if the device is HV to choose between
  // LV battery scanning (0x32-0x37) and HV scanning (BAMS→BCU→BMU).
  const pm = new PollManager({ host: '127.0.0.1' });
  expect((pm as any)._deviceType).toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/poll-manager.test.ts --reporter=verbose`
Expected: FAIL — `_deviceType` is undefined (not null)

**Step 3: Implement HV scanning in PollManager**

Add to `src/poll-manager.ts`:

a) Add imports at top:

```typescript
import { detectModel, isHighVoltage, type DeviceType } from './model/device-types.js';
```

b) Add `_deviceType` field after `_generation`:

```typescript
private _deviceType: DeviceType | null = null;
```

c) Add `_bcuList` field to store discovered BCU→module count mappings:

```typescript
private _bcuList: Array<{ bcuIndex: number; moduleCount: number }> = [];
```

d) Add a `_readBatteryRange` method for reading from non-inverter slaves:

```typescript
/**
 * Read input registers from a battery/BCU/BMU slave.
 * Returns the register values, or null on failure.
 */
private async _readSlaveRegisters(
  slaveAddress: number,
  baseRegister: number,
  registerCount: number,
): Promise<number[] | null> {
  const frame = encodeReadInputRegistersRequest({
    dataAdapterSerial: this.client.dataAdapterSerial,
    slaveAddress,
    baseRegister,
    registerCount,
  });
  try {
    return await this.client.sendRequest(frame);
  } catch {
    return null;
  }
}
```

e) Add `_scanHvBatteries` method:

```typescript
/**
 * Scan HV battery hierarchy: BAMS → BCU → BMU.
 *
 * 1. Read BAMS at 0xA0 to discover BCU count
 * 2. Read each BCU at 0x70+N for pack data and module count
 * 3. Read each BMU at 0x50+N with base register offset per BCU
 */
private async _scanHvBatteries(): Promise<void> {
  // Step 1: Read BAMS to discover BCU count
  this.emit('debug', `reading BAMS (slave=0x${BAMS_SLAVE.toString(16)}, base=${BATTERY_REGISTER_START}, count=5)`);
  const bamsValues = await this._readSlaveRegisters(BAMS_SLAVE, BATTERY_REGISTER_START, 5);
  if (!bamsValues) {
    this.emit('debug', 'BAMS did not respond, skipping HV battery scan');
    return;
  }
  const numberOfBcus = bamsValues[BAMS_NUMBER_OF_BCUS_REGISTER - BATTERY_REGISTER_START] ?? 0;
  this.emit('debug', `BAMS reports ${numberOfBcus} BCU(s)`);

  if (numberOfBcus === 0) return;

  this._bcuList = [];

  // Step 2: Read each BCU
  for (let bcuIndex = 0; bcuIndex < numberOfBcus; bcuIndex++) {
    const bcuSlave = BCU_BASE_SLAVE + bcuIndex;
    this.emit('debug', `reading BCU ${bcuIndex} (slave=0x${bcuSlave.toString(16)}, base=${BATTERY_REGISTER_START}, count=${BATTERY_REGISTER_COUNT})`);
    const bcuValues = await this._readSlaveRegisters(bcuSlave, BATTERY_REGISTER_START, BATTERY_REGISTER_COUNT);
    await this._delay(INTER_READ_DELAY_MS);

    if (!bcuValues) {
      this.emit('debug', `BCU ${bcuIndex} did not respond, stopping BCU scan`);
      break;
    }

    // Store BCU registers
    const bcuCache = this._batteryRegisters.get(bcuSlave) ?? new Map<number, number>();
    bcuValues.forEach((v, i) => bcuCache.set(BATTERY_REGISTER_START + i, v));
    this._batteryRegisters.set(bcuSlave, bcuCache);

    const moduleCount = bcuValues[BCU_NUMBER_OF_MODULES_REGISTER - BATTERY_REGISTER_START] ?? 0;
    this.emit('debug', `BCU ${bcuIndex} has ${moduleCount} module(s)`);
    this._bcuList.push({ bcuIndex, moduleCount });

    // Step 3: Read each BMU for this BCU
    for (let bmuIndex = 0; bmuIndex < moduleCount; bmuIndex++) {
      const bmuSlave = BMU_BASE_SLAVE + bmuIndex;
      const bmuBase = BATTERY_REGISTER_START + (BMU_BCU_OFFSET * bcuIndex);
      this.emit('debug', `reading BMU ${bmuIndex} (slave=0x${bmuSlave.toString(16)}, base=${bmuBase}, count=${BMU_REGISTER_COUNT})`);
      const bmuValues = await this._readSlaveRegisters(bmuSlave, bmuBase, BMU_REGISTER_COUNT);
      await this._delay(INTER_READ_DELAY_MS);

      if (!bmuValues) {
        this.emit('debug', `BMU ${bmuIndex} did not respond, stopping BMU scan for BCU ${bcuIndex}`);
        break;
      }

      // Store BMU registers normalized to base 60 for consistent snapshot building.
      // The BCU offset only affects the Modbus request addressing, not the register layout.
      const bmuKey = (bcuIndex << 8) | bmuIndex; // unique key per BCU+BMU combination
      const bmuCache = new Map<number, number>();
      bmuValues.forEach((v, i) => bmuCache.set(BATTERY_REGISTER_START + i, v));
      this._batteryRegisters.set(bmuKey, bmuCache);

      this.emit('debug', `BMU ${bmuIndex} ok (${bmuValues.length} values)`);
    }
  }
}
```

f) Modify `_executePoll` to use HV scanning when appropriate. Replace the LV battery scan block (lines 198-217) with:

```typescript
if (doFull) {
  // Detect device type for HV vs LV battery scanning
  if (this._deviceType === null) {
    const modelCode = this._holdingRegisters.get(0) ?? 0;
    const armFw = this._holdingRegisters.get(21) ?? 0;
    if (modelCode !== 0) {
      this._deviceType = detectModel(modelCode, armFw);
      this.emit('debug', `detected device type: ${this._deviceType} (HV: ${isHighVoltage(this._deviceType)})`);
    }
  }

  // Clear previous battery data for full refresh
  this._batteryRegisters.clear();

  if (this._deviceType !== null && isHighVoltage(this._deviceType)) {
    await this._scanHvBatteries();
  } else {
    // LV battery scan (existing logic)
    for (const slave of LV_BATTERY_SLAVES) {
      try {
        this.emit('debug', `reading battery registers (slave=0x${slave.toString(16)}, base=${BATTERY_REGISTER_START}, count=${BATTERY_REGISTER_COUNT})`);
        const batFrame = encodeReadInputRegistersRequest({
          dataAdapterSerial: this.client.dataAdapterSerial,
          slaveAddress: slave,
          baseRegister: BATTERY_REGISTER_START,
          registerCount: BATTERY_REGISTER_COUNT,
        });
        const batValues = await this.client.sendRequest(batFrame);
        this.emit('debug', `battery 0x${slave.toString(16)} ok (${batValues.length} values)`);
        const batCache = this._batteryRegisters.get(slave) ?? new Map<number, number>();
        batValues.forEach((v, i) => batCache.set(BATTERY_REGISTER_START + i, v));
        this._batteryRegisters.set(slave, batCache);
      } catch {
        this.emit('debug', `battery 0x${slave.toString(16)} did not respond, stopping battery scan`);
        break;
      }
    }
  }
  // ... meter scan continues unchanged
```

g) Pass `isHighVoltage` flag and `_bcuList` to buildSnapshot:

Update the `buildSnapshot` call to pass HV metadata:

```typescript
const snapshot = buildSnapshot(cache, {
  previousSnapshot: this._previousSnapshot,
  batteryRegisterCaches: this._batteryRegisters,
  meterRegisterCaches,
  isHighVoltage: this._deviceType !== null && isHighVoltage(this._deviceType),
  bcuList: this._bcuList,
});
```

**Step 4: Run tests**

Run: `npx vitest run test/poll-manager.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/poll-manager.ts
git commit -m "feat: add HV battery scanning via BAMS, BCU, and BMU

Fixes #5. When device type is HV, PollManager reads BAMS (0xA0) to
discover BCUs, reads each BCU (0x70+) for pack data, then reads each
BMU (0x50+) for per-module cell data."
```

---

### Task 6: Update buildSnapshot to handle HV battery data

**Files:**
- Modify: `src/snapshot-builder.ts`
- Test: `test/snapshot-builder.test.ts`

**Step 1: Write failing tests**

Add to `test/snapshot-builder.test.ts` in the `buildSnapshot` describe block:

```typescript
it('builds BMU battery snapshots with stack field for HV systems', () => {
  const cache = makeValidCache();
  // Set device type to AIO (HV)
  cache.holdingRegisters.set(0, 0x8001);

  // BCU 0 data at slave 0x70
  const bcuCache = new Map<number, number>();
  bcuCache.set(64, 2);     // 2 modules
  bcuCache.set(80, (95 << 8) | 90);  // soc_max=95, soc_min=90
  bcuCache.set(82, 0);     // charge_energy_total high
  bcuCache.set(83, 5000);  // charge_energy_total low → 500.0 kWh
  bcuCache.set(84, 0);     // discharge_energy_total high
  bcuCache.set(85, 4500);  // discharge_energy_total low → 450.0 kWh
  bcuCache.set(100, 150);  // cycles → toDeci = 15.0

  // BMU 0 (key = (0 << 8) | 0 = 0)
  const bmu0Cache = new Map<number, number>();
  const serial0 = 'HV00000001';
  for (let i = 0; i < 5; i++) {
    bmu0Cache.set(114 + i, (serial0.charCodeAt(i * 2) << 8) | serial0.charCodeAt(i * 2 + 1));
  }
  for (let i = 0; i < 24; i++) {
    bmu0Cache.set(60 + i, 3300);
    bmu0Cache.set(90 + i, 250);
  }

  // BMU 1 (key = (0 << 8) | 1 = 1)
  const bmu1Cache = new Map<number, number>();
  const serial1 = 'HV00000002';
  for (let i = 0; i < 5; i++) {
    bmu1Cache.set(114 + i, (serial1.charCodeAt(i * 2) << 8) | serial1.charCodeAt(i * 2 + 1));
  }
  for (let i = 0; i < 24; i++) {
    bmu1Cache.set(60 + i, 3300);
    bmu1Cache.set(90 + i, 250);
  }

  const batteryCaches = new Map<number, Map<number, number>>([
    [0x70, bcuCache],
    [0, bmu0Cache],     // bcuIndex=0, bmuIndex=0
    [1, bmu1Cache],     // bcuIndex=0, bmuIndex=1
  ]);

  const snapshot = buildSnapshot(cache, {
    batteryRegisterCaches: batteryCaches,
    isHighVoltage: true,
    bcuList: [{ bcuIndex: 0, moduleCount: 2 }],
  });

  expect(snapshot!.batteries).toHaveLength(2);
  expect(snapshot!.batteries[0].serialNumber).toBe('HV00000001');
  expect(snapshot!.batteries[0].stack).toBe(0);
  expect(snapshot!.batteries[0].cellVoltages).toHaveLength(24);
  expect(snapshot!.batteries[1].serialNumber).toBe('HV00000002');
  expect(snapshot!.batteries[1].stack).toBe(0);
});

it('populates inverter battery energy totals from BCU data for HV systems', () => {
  const cache = makeValidCache();
  cache.holdingRegisters.set(0, 0x8001);

  const bcuCache = new Map<number, number>();
  bcuCache.set(64, 1);
  bcuCache.set(82, 0);
  bcuCache.set(83, 5000);  // charge_total → 500.0 kWh
  bcuCache.set(84, 0);
  bcuCache.set(85, 4500);  // discharge_total → 450.0 kWh

  // Minimal BMU
  const bmuCache = new Map<number, number>();
  const serial = 'HV00000001';
  for (let i = 0; i < 5; i++) {
    bmuCache.set(114 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }

  const batteryCaches = new Map<number, Map<number, number>>([
    [0x70, bcuCache],
    [0, bmuCache],
  ]);

  const snapshot = buildSnapshot(cache, {
    batteryRegisterCaches: batteryCaches,
    isHighVoltage: true,
    bcuList: [{ bcuIndex: 0, moduleCount: 1 }],
  });

  expect(snapshot!.batteryChargeEnergyTotalKwh).toBeCloseTo(500.0, 1);
  expect(snapshot!.batteryDischargeEnergyTotalKwh).toBeCloseTo(450.0, 1);
});

it('LV battery scan is unchanged when not HV', () => {
  // Verify existing LV behaviour is unaffected
  const cache = makeValidCache();
  const batteryCache = new Map<number, number>();
  const serial = 'CE1234B001';
  for (let i = 0; i < 5; i++) {
    batteryCache.set(110 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }
  batteryCache.set(100, 80);
  for (let i = 0; i < 16; i++) batteryCache.set(60 + i, 3250);

  const snapshot = buildSnapshot(cache, {
    batteryRegisterCaches: new Map([[0x32, batteryCache]]),
    isHighVoltage: false,
  });

  expect(snapshot!.batteries).toHaveLength(1);
  expect(snapshot!.batteries[0].serialNumber).toBe('CE1234B001');
  expect(snapshot!.batteries[0].stack).toBeUndefined();
  expect(snapshot!.batteries[0].cellVoltages).toHaveLength(16);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/snapshot-builder.test.ts --reporter=verbose`
Expected: FAIL — `bcuList` not on type

**Step 3: Update buildSnapshot for HV**

a) Update `SnapshotBuilderOptions`:

```typescript
export interface SnapshotBuilderOptions {
  previousSnapshot?: InverterSnapshot | null;
  batteryRegisterCaches?: Map<number, Map<number, number>>;
  meterRegisterCaches?: Map<number, { data: Map<number, number>; product: Map<number, number> }>;
  isHighVoltage?: boolean;
  bcuList?: Array<{ bcuIndex: number; moduleCount: number }>;
}
```

b) Update the batteries section in `buildSnapshot` (around lines 314-321):

```typescript
// ── Batteries ─────────────────────────────────────────────────────────────
const batteries: BatterySnapshot[] = [];
const isHv = options.isHighVoltage ?? false;
const bcuList = options.bcuList ?? [];

if (isHv && bcuList.length > 0) {
  // HV: build BMU snapshots from per-module register caches
  for (const { bcuIndex, moduleCount } of bcuList) {
    const bcuSlave = 0x70 + bcuIndex;
    const bcuCache = batteryRegisterCaches.get(bcuSlave);
    const bcuData = bcuCache ? parseBcuData(bcuCache) : null;

    for (let bmuIndex = 0; bmuIndex < moduleCount; bmuIndex++) {
      const bmuKey = (bcuIndex << 8) | bmuIndex;
      const bmuCache = batteryRegisterCaches.get(bmuKey);
      if (!bmuCache) continue;

      const bmu = buildBmuSnapshot(bmuCache, bcuIndex);
      if (bmu !== null) {
        // Populate pack-level data from BCU onto each BMU snapshot
        if (bcuData) {
          bmu.stateOfCharge = bcuData.stateOfChargeMax;
          bmu.voltage = bcuData.voltage;
          bmu.cycleCount = bcuData.cycleCount;
        }
        batteries.push(bmu);
      }
    }
  }
} else {
  // LV: existing logic
  for (const [, irCache] of batteryRegisterCaches) {
    const bat = buildBatterySnapshot(irCache);
    if (bat !== null) {
      batteries.push(bat);
    }
  }
}
```

c) Update the battery energy totals section (around lines 332-354) to use BCU data for HV:

```typescript
let batteryChargeEnergyTotalKwh = 0;
let batteryDischargeEnergyTotalKwh = 0;

if (isHv && bcuList.length > 0) {
  // HV: sum energy totals from all BCUs
  for (const { bcuIndex } of bcuList) {
    const bcuSlave = 0x70 + bcuIndex;
    const bcuCache = batteryRegisterCaches.get(bcuSlave);
    if (bcuCache) {
      const bcuData = parseBcuData(bcuCache);
      batteryChargeEnergyTotalKwh += bcuData.chargeEnergyTotalKwh;
      batteryDischargeEnergyTotalKwh += bcuData.dischargeEnergyTotalKwh;
    }
  }
} else if (batteries.length > 0) {
  // LV: sum across all battery modules
  batteryChargeEnergyTotalKwh = batteries.reduce((sum, b) => sum + b.chargeEnergyTotalKwh, 0);
  batteryDischargeEnergyTotalKwh = batteries.reduce((sum, b) => sum + b.dischargeEnergyTotalKwh, 0);
}
if (batteryChargeEnergyTotalKwh === 0 && batteryDischargeEnergyTotalKwh === 0) {
  // Fallback to inverter registers (same for both LV and HV)
  const invCharge = toDeci(getIR(cache, 181));
  const invDischarge = toDeci(getHR(cache, 180));
  if (invCharge !== 0 || invDischarge !== 0) {
    batteryChargeEnergyTotalKwh = invCharge;
    batteryDischargeEnergyTotalKwh = invDischarge;
  } else {
    batteryChargeEnergyTotalKwh = toDeci(toUint32(getIR(cache, 27), getIR(cache, 28)));
    batteryDischargeEnergyTotalKwh = toDeci(getIR(cache, 29));
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/snapshot-builder.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/snapshot-builder.ts test/snapshot-builder.test.ts
git commit -m "feat: handle HV battery data in buildSnapshot

Fixes #5. When isHighVoltage is true, buildSnapshot uses BCU register
caches for energy totals and builds BMU snapshots with 24 cell voltages,
stack index, and pack-level SOC/voltage from the BCU."
```

---

### Task 7: Update plant.ts detectBatteries for HV

**Files:**
- Modify: `src/model/plant.ts`
- Test: `test/discover.test.ts` (or create if needed)

**Step 1: Check existing tests**

Run: `npx vitest run test/discover.test.ts --reporter=verbose`

**Step 2: Write failing test**

```typescript
it('returns BCU count for HV devices from BAMS data', () => {
  // HV systems report battery count via BAMS, not by scanning LV slave addresses.
  const registerCache = new Map<number, Map<number, number>>();
  // BAMS slave 0xA0 with 2 BCUs at IR(61)
  const bamsCache = new Map<number, number>();
  bamsCache.set(61, 2);
  registerCache.set(0xa0, bamsCache);
  expect(detectBatteries(registerCache, true)).toBe(2);
});

it('returns 0 for HV devices when BAMS data is missing', () => {
  const registerCache = new Map<number, Map<number, number>>();
  expect(detectBatteries(registerCache, true)).toBe(0);
});
```

**Step 3: Implement**

Update `detectBatteries` in `src/model/plant.ts`:

```typescript
export function detectBatteries(
  registerCache: Map<number, Map<number, number>>,
  highVoltage: boolean,
  deviceType?: DeviceType,
): number {
  if (deviceType === DeviceType.EMS || deviceType === DeviceType.GATEWAY) {
    return 0;
  }
  if (highVoltage) {
    // HV: read BCU count from BAMS at slave 0xA0, IR(61)
    const bamsCache = registerCache.get(0xa0);
    if (!bamsCache) return 0;
    return bamsCache.get(61) ?? 0;
  }

  // LV: scan 0x32-0x37 (unchanged)
  let count = 0;
  for (const addr of LV_BATTERY_SLAVE_ADDRESSES) {
    const cache = registerCache.get(addr);
    if (!cache) break;
    const regs: number[] = [];
    for (let i = 0; i < SERIAL_LENGTH; i++) {
      regs.push(cache.get(SERIAL_START + i) ?? 0);
    }
    const serial = registersToString(regs);
    if (INVALID_SERIALS.has(serial)) break;
    count++;
  }
  return count;
}
```

**Step 4: Run tests**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/model/plant.ts test/discover.test.ts
git commit -m "feat: implement HV battery detection via BAMS in detectBatteries

Fixes #5. For HV devices, detectBatteries reads BCU count from
BAMS register cache at slave 0xA0, IR(61)."
```

---

### Task 8: Update snapshot script and run full test suite

**Files:**
- Check: `scripts/` directory for snapshot script
- Test: full suite

**Step 1: Check snapshot script**

Read the snapshot script and ensure it displays the new `stack` field and handles HV batteries correctly. If it loops over `batteries[]`, it should already work since HV BMUs populate the same array.

**Step 2: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

**Step 3: Build**

Run: `npm run build`
Expected: SUCCESS (no type errors)

**Step 4: Commit any script updates if needed**

---

### Task 9: Final commit and cleanup

**Step 1: Run full test suite one final time**

Run: `npx vitest run --reporter=verbose`

**Step 2: Run build**

Run: `npm run build`

**Step 3: Review all changes**

Run: `git diff main...HEAD --stat`

Verify:
- `src/model/battery-snapshot.ts` — `stack` field added
- `src/poll-manager.ts` — HV constants, `_scanHvBatteries`, device type detection
- `src/snapshot-builder.ts` — `buildBmuSnapshot`, `parseBcuData`, HV path in `buildSnapshot`
- `src/model/plant.ts` — HV detection in `detectBatteries`
- Tests cover all new code paths
