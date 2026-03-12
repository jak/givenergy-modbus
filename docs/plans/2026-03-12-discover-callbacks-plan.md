# Discover Callbacks Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix issue #27 by replacing `onProbe` with `onScanProgress` + `onFound` callbacks, and enriching `DiscoveredDevice` with identity data from `GivEnergyInverter.identify()`.

**Architecture:** Two-phase discover stays the same. Phase 1 TCP scan fires `onScanProgress`. Phase 2 replaces `verifyInverter()` with `GivEnergyInverter.identify()` and fires `onFound` per verified device. `DiscoveredDevice` gains `serialNumber`, `generation`, `modelCode` fields.

**Tech Stack:** TypeScript, vitest, net module for mock TCP servers.

---

### Task 1: Extract shared test frame builder

Both `test/discover.test.ts` and `test/inverter.test.ts` have their own frame builders. Extract to a shared helper since discover tests will now need the 60-register version.

**Files:**
- Create: `test/helpers/mock-frame.ts`
- Modify: `test/inverter.test.ts:12-62` (remove local helpers, import shared)
- Modify: `test/discover.test.ts:14-67` (remove `buildMockResponse`, import shared)

**Step 1: Create shared helper**

```ts
// test/helpers/mock-frame.ts
import { PayloadEncoder } from '../../src/codec.js';

/**
 * Build a mock GivEnergy response frame for a read holding registers request
 * (slave=0x11, fc=0x03, base=0, count=registers.length).
 */
export function buildMockResponse(registers: number[]): Buffer {
  const serial = '**********';
  const inverterSerial = '**********';
  const slaveAddress = 0x11;
  const fc = 0x03;
  const baseRegister = 0;
  const registerCount = registers.length;

  const crcEnc = new PayloadEncoder();
  crcEnc.addUint8(slaveAddress);
  crcEnc.addUint8(fc);
  crcEnc.addString(inverterSerial, 10);
  crcEnc.addUint16(baseRegister);
  crcEnc.addUint16(registerCount);
  for (const val of registers) crcEnc.addUint16(val);
  const crc = crcEnc.crc;
  const swappedCrc = ((crc & 0xFF) << 8) | ((crc >> 8) & 0xFF);

  const bodyEnc = new PayloadEncoder();
  bodyEnc.addUint8(0x01); // uid
  bodyEnc.addUint8(0x02); // fid: transparent
  bodyEnc.addString(serial, 10);
  for (let i = 0; i < 7; i++) bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x08);
  bodyEnc.addUint8(slaveAddress);
  bodyEnc.addUint8(fc);
  bodyEnc.addString(inverterSerial, 10);
  bodyEnc.addUint16(baseRegister);
  bodyEnc.addUint16(registerCount);
  for (const val of registers) bodyEnc.addUint16(val);
  bodyEnc.addUint16(swappedCrc);

  const body = bodyEnc.payload;
  const frameEnc = new PayloadEncoder();
  frameEnc.addUint16(0x5959);
  frameEnc.addUint16(0x0001);
  frameEnc.addUint16(body.length);
  for (const byte of body) frameEnc.addUint8(byte);
  return frameEnc.payload;
}

/** Encode a string (up to 10 chars) into register values (2 chars per register). */
export function stringToRegisters(str: string): number[] {
  const padded = str.padEnd(10, '\x00');
  const regs: number[] = [];
  for (let i = 0; i < 10; i += 2) {
    regs.push((padded.charCodeAt(i) << 8) | padded.charCodeAt(i + 1));
  }
  return regs;
}
```

**Step 2: Update `test/inverter.test.ts` to import shared helpers**

Replace lines 1-62 imports and local helpers with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server, type Socket } from 'net';
import { GivEnergyInverter } from '../src/inverter.js';
import { Gen2Inverter } from '../src/inverters/gen2.js';
import { Gen3Inverter } from '../src/inverters/gen3.js';
import { ThreePhaseInverter } from '../src/inverters/three-phase.js';
import { PollManager } from '../src/poll-manager.js';
import { buildMockResponse as buildIdentifyResponse, stringToRegisters } from './helpers/mock-frame.js';
```

Remove the local `buildIdentifyResponse` (lines 12-52) and `stringToRegisters` (lines 55-62) functions.

**Step 3: Update `test/discover.test.ts` to import shared helpers**

Replace the local `buildMockResponse` (lines 14-67) with an import. The old `buildMockResponse()` built a 1-register response; callers will now use `buildMockResponse([0x0001])` from the shared helper.

**Step 4: Run tests**

Run: `npm test`
Expected: All existing tests pass (no behavior change, just extraction).

**Step 5: Commit**

```bash
git add test/helpers/mock-frame.ts test/inverter.test.ts test/discover.test.ts
git commit -m "refactor: extract shared mock frame builder to test/helpers"
```

---

### Task 2: Update `DiscoveredDevice` and `DiscoverOptions` types

**Files:**
- Modify: `src/discover.ts:1-14,116-120` (types and imports)
- Modify: `src/index.ts:9` (re-export updated type)

**Step 1: Write failing test**

Add to `test/discover.test.ts`:

```ts
it('DiscoveredDevice includes identity fields', async () => {
  // Type-level test: verify the shape of DiscoveredDevice
  const device: DiscoveredDevice = {
    host: '10.0.0.1',
    serialNumber: 'CE1234G567',
    generation: 'gen2',
    modelCode: 0x2001,
  };
  expect(device.serialNumber).toBe('CE1234G567');
  expect(device.generation).toBe('gen2');
  expect(device.modelCode).toBe(0x2001);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/discover.test.ts`
Expected: FAIL — `serialNumber`, `generation`, `modelCode` not in `DiscoveredDevice`.

**Step 3: Update types in `src/discover.ts`**

Replace `DiscoveredDevice` interface (lines 12-14):

```ts
import { GivEnergyInverter, type InverterIdentity } from './inverter.js';
import type { InverterGeneration } from './generation.js';

export interface DiscoveredDevice {
  host: string;
  serialNumber: string;
  generation: InverterGeneration;
  modelCode: number;
}
```

Replace `DiscoverOptions` interface (lines 116-120):

```ts
export interface DiscoverOptions {
  subnet?: string;
  /** Fires after each host is TCP-scanned in Phase 1. Use for progress UI. */
  onScanProgress?: (host: string, portOpen: boolean) => void;
  /** Fires when a host passes Phase 2 modbus verification — confirmed GivEnergy inverter. */
  onFound?: (device: DiscoveredDevice) => void;
}
```

Remove the `Client` and `encodeReadHoldingRegistersRequest` imports (lines 3-4) and the `VERIFY_TIMEOUT_MS` constant (line 9) — no longer needed after task 3 removes `verifyInverter`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/discover.test.ts`
Expected: The new type test passes. Existing tests will have type errors from `onProbe` — that's expected and fixed in task 3.

**Step 5: Commit**

```bash
git add src/discover.ts src/index.ts test/discover.test.ts
git commit -m "feat: update DiscoveredDevice and DiscoverOptions types (issue #27)"
```

---

### Task 3: Replace `verifyInverter` with `identify()` and wire up callbacks

**Files:**
- Modify: `src/discover.ts:92-173` (remove `verifyInverter`, update `discover()`)

**Step 1: Write failing test for `onScanProgress` callback**

Add to `test/discover.test.ts` in the `discover verification` describe block:

```ts
it('calls onScanProgress during Phase 1 TCP scan', async () => {
  let server: net.Server | undefined;
  const registers = new Array(60).fill(0);
  registers[0] = 0x2001;
  const serialRegs = stringToRegisters('CE1234G567');
  for (let i = 0; i < 5; i++) registers[13 + i] = serialRegs[i];
  registers[21] = 899;
  const response = buildMockResponse(registers);

  try {
    server = net.createServer(socket => {
      socket.once('data', () => socket.write(response));
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(8899, '127.0.0.1', resolve);
    });
  } catch {
    return; // port 8899 unavailable — skip
  }

  try {
    const probes: Array<{ host: string; portOpen: boolean }> = [];
    await discover({
      subnet: '127.0.0.1/32',
      onScanProgress: (host, portOpen) => probes.push({ host, portOpen }),
    });
    expect(probes).toEqual([{ host: '127.0.0.1', portOpen: true }]);
  } finally {
    server.close();
  }
}, 10000);
```

**Step 2: Write failing test for `onFound` callback**

```ts
it('calls onFound only for verified inverters', async () => {
  let server: net.Server | undefined;
  const registers = new Array(60).fill(0);
  registers[0] = 0x2001;
  const serialRegs = stringToRegisters('CE1234G567');
  for (let i = 0; i < 5; i++) registers[13 + i] = serialRegs[i];
  registers[21] = 899;
  const response = buildMockResponse(registers);

  try {
    server = net.createServer(socket => {
      socket.once('data', () => socket.write(response));
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(8899, '127.0.0.1', resolve);
    });
  } catch {
    return;
  }

  try {
    const found: DiscoveredDevice[] = [];
    await discover({
      subnet: '127.0.0.1/32',
      onFound: (device) => found.push(device),
    });
    expect(found).toHaveLength(1);
    expect(found[0].host).toBe('127.0.0.1');
    expect(found[0].serialNumber).toBe('CE1234G567');
    expect(found[0].generation).toBe('gen2');
  } finally {
    server.close();
  }
}, 10000);
```

**Step 3: Write failing test — `onFound` does not fire for non-inverter hosts**

```ts
it('does not call onFound for hosts that fail modbus verification', async () => {
  let server: net.Server | undefined;
  try {
    // Server accepts TCP but sends garbage — not a GivEnergy inverter
    server = net.createServer(socket => {
      socket.once('data', () => {
        socket.write(Buffer.from('HTTP/1.1 200 OK\r\n\r\nHello'));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(8899, '127.0.0.1', resolve);
    });
  } catch {
    return;
  }

  try {
    const found: DiscoveredDevice[] = [];
    const probes: Array<{ host: string; portOpen: boolean }> = [];
    const results = await discover({
      subnet: '127.0.0.1/32',
      onScanProgress: (host, portOpen) => probes.push({ host, portOpen }),
      onFound: (device) => found.push(device),
    });
    // Phase 1: port was open
    expect(probes).toEqual([{ host: '127.0.0.1', portOpen: true }]);
    // Phase 2: verification failed, so onFound was never called
    expect(found).toEqual([]);
    expect(results).toEqual([]);
  } finally {
    server.close();
  }
}, 10000);
```

**Step 4: Run tests to verify they fail**

Run: `npx vitest run test/discover.test.ts`
Expected: FAIL — `onScanProgress` and `onFound` not recognized / `onProbe` still in use.

**Step 5: Implement — update `discover()` in `src/discover.ts`**

Remove `verifyInverter()` function (lines 92-114).

Replace the `discover()` function body (lines 133-173):

```ts
export async function discover(subnetOrOptions?: string | DiscoverOptions): Promise<DiscoveredDevice[]> {
  const options: DiscoverOptions = typeof subnetOrOptions === 'string'
    ? { subnet: subnetOrOptions }
    : (subnetOrOptions ?? {});

  const cidr = options.subnet ?? getLocalSubnet();
  const hosts = parseSubnet(cidr);
  const candidates: string[] = [];

  // Phase 1: Fast TCP port scan
  for (let i = 0; i < hosts.length; i += CONCURRENCY) {
    const batch = hosts.slice(i, i + CONCURRENCY);
    const checks = await Promise.all(
      batch.map(async host => {
        const open = await tryConnect(host, INVERTER_PORT, SCAN_TIMEOUT_MS);
        options.onScanProgress?.(host, open);
        return open ? host : null;
      })
    );
    for (const host of checks) {
      if (host !== null) candidates.push(host);
    }
  }

  // Phase 2: Identify each candidate with a modbus probe
  const results: DiscoveredDevice[] = [];
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const identified = await Promise.all(
      batch.map(async host => {
        try {
          const identity = await GivEnergyInverter.identify({ host });
          return { host, ...identity };
        } catch {
          return null;
        }
      })
    );
    for (const device of identified) {
      if (device !== null) {
        results.push(device);
        options.onFound?.(device);
      }
    }
  }

  return results;
}
```

Also clean up imports at the top of `src/discover.ts` — remove `Client` and `encodeReadHoldingRegistersRequest` imports, remove `VERIFY_TIMEOUT_MS`.

**Step 6: Run tests to verify they pass**

Run: `npx vitest run test/discover.test.ts`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add src/discover.ts test/discover.test.ts
git commit -m "feat: replace onProbe with onScanProgress + onFound callbacks (fixes #27)"
```

---

### Task 4: Update existing discover tests for enriched `DiscoveredDevice`

The existing test `'discovers a host that responds with a valid GivEnergy frame'` asserts `toEqual([{ host: '127.0.0.1' }])` — now it needs to match the enriched shape.

**Files:**
- Modify: `test/discover.test.ts:125-151` (update assertion)

**Step 1: Update the mock response**

The existing `buildMockResponse()` in discover tests builds a 1-register frame. Since `identify()` reads 60 registers and checks for a non-empty serial, the mock must now use 60 registers with a valid serial. Update the mock server in the existing verification tests to use the shared `buildMockResponse` with 60 registers including identity data.

Replace the mock setup in `'discovers a host that responds with a valid GivEnergy frame'`:

```ts
it('discovers a host that responds with a valid GivEnergy frame', async () => {
  const registers = new Array(60).fill(0);
  registers[0] = 0x2001; // device type code
  const serialRegs = stringToRegisters('CE1234G567');
  for (let i = 0; i < 5; i++) registers[13 + i] = serialRegs[i];
  registers[21] = 899; // ARM firmware version
  const response = buildMockResponse(registers);
  // ... rest of test with updated assertion:
  expect(results).toEqual([{
    host: '127.0.0.1',
    serialNumber: 'CE1234G567',
    generation: 'gen2',
    modelCode: 0x2001,
  }]);
```

**Step 2: Run tests**

Run: `npx vitest run test/discover.test.ts`
Expected: All pass.

**Step 3: Commit**

```bash
git add test/discover.test.ts
git commit -m "test: update discover assertions for enriched DiscoveredDevice"
```

---

### Task 5: Update scripts and run full verification

**Files:**
- Modify: `scripts/identify.mjs` (already uses `discover()` — verify it still works)
- Check: Any other scripts that use `onProbe`

**Step 1: Check for any other `onProbe` references**

Run: `grep -r onProbe src/ test/ scripts/`
Expected: No remaining references.

**Step 2: Build and run full test suite**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass.

**Step 3: Run identify script against real device (read-only, safe)**

Run: `npm run build && npm run script:identify`
Expected: Script works — `discover()` finds the inverter and `identify()` returns its identity.

**Step 4: Commit any script updates if needed**

```bash
git commit -m "chore: verify scripts work with updated discover API"
```
