# Discover Callbacks Redesign

**Issue:** [#27](https://github.com/jak/givenergy-modbus/issues/27) — `onProbe` emits `found: true` for non-inverter devices

## Problem

`discover()` fires `onProbe(host, true)` after the Phase 1 TCP port scan, before Phase 2 modbus verification. Any device with port 8899 open is reported as "found", even if it's not a GivEnergy inverter.

## Design

### Replace `onProbe` with two callbacks

Remove `onProbe`. Add:

- **`onScanProgress(host: string, portOpen: boolean)`** — fires after each Phase 1 TCP probe. Use for progress UI (e.g. "scanning 127/254 hosts").
- **`onFound(device: DiscoveredDevice)`** — fires after Phase 2 modbus verification succeeds. Only real GivEnergy inverters trigger this.

### Enrich `DiscoveredDevice` with identity

Replace `verifyInverter()` with `GivEnergyInverter.identify()` in Phase 2. This already does a single modbus read — same cost as today — but extracts serial, generation, and model code.

```ts
export interface DiscoveredDevice {
  host: string;
  serialNumber: string;
  generation: InverterGeneration;
  modelCode: number;
}
```

`onFound` emits the enriched object, so consumers get identity for free without a second round-trip.

### Updated `DiscoverOptions`

```ts
export interface DiscoverOptions {
  subnet?: string;
  /** Fires after each host is TCP-scanned in Phase 1. */
  onScanProgress?: (host: string, portOpen: boolean) => void;
  /** Fires when a host passes Phase 2 modbus verification. */
  onFound?: (device: DiscoveredDevice) => void;
}
```

### Behaviour

- Phase 1 unchanged: TCP port scan on 8899, batched with concurrency 20, 1s timeout. Calls `onScanProgress` after each probe.
- Phase 2: call `GivEnergyInverter.identify()` on each candidate. On success, call `onFound` immediately (don't wait for all candidates). On failure (timeout, bad frame, empty serial), skip silently.
- Return value stays `Promise<DiscoveredDevice[]>` — now enriched with identity fields.
- `verifyInverter()` is removed (replaced by `identify()`).

### Tests

- Migrate existing `onProbe` test coverage to `onScanProgress`.
- Test that `onFound` fires only for verified inverters (mock TCP server with valid GivEnergy frame).
- Test that `onFound` does not fire for hosts that accept TCP but fail modbus verification.
- Test that `DiscoveredDevice` includes identity fields.
