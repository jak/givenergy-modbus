# HV Battery Scanning Design

Fixes #5.

## Problem

PollManager only scans LV battery slaves at `0x32`-`0x37`. HV systems (AIO, AC 3-Phase, Hybrid 3-Phase, Hybrid HV Gen3) use a 3-level hierarchy: BAMS → BCU → BMU. The `isHighVoltage()` function exists but is never used. HV users see no battery data.

## HV Battery Architecture

| Level | Slave Address | Purpose |
|-------|--------------|---------|
| BAMS (Battery Aggregation & Management System) | `0xA0` | Tells how many BCUs exist via IR(61) |
| BCU (Battery Control Unit) | `0x70 + index` | Pack-level data; IR(64) = number of modules |
| BMU (Battery Module Unit) | `0x50 + index` | Module-level data; 24 cell voltages |

Register addressing for BMU reads uses an offset: base `60 + (120 x bcu_index)`.

## Approach: Dynamic Discovery via BAMS

1. Read BAMS at `0xA0` IR(60-65) to get `number_of_bcus`
2. For each BCU: read IR(60-119) from slave `0x70 + i`, extract module count from IR(64)
3. For each BMU: read from slave `0x50 + j`, base register `60 + (120 x bcu_index)`, count 60
4. Store data in register caches for snapshot building

## Snapshot Model

Unified `batteries: BatterySnapshot[]` field for both LV and HV — no separate fields.

- LV: each entry is one battery module (16 cells), as today
- HV: each BMU becomes one `BatterySnapshot` entry (24 cells)
- New optional `stack?: number` field on `BatterySnapshot` to indicate which BCU the module belongs to, for users who need hierarchy info

## Components

| Component | Change |
|-----------|--------|
| `device-types.ts` | Already has `isHighVoltage()` — no changes needed |
| `plant.ts` | Implement HV detection via BAMS read, replace "not yet implemented" |
| `poll-manager.ts` | Add HV scanning path: BAMS → BCU → BMU |
| `snapshot-builder.ts` | Build `BatterySnapshot` from BMU registers, populate `stack` field |
| `model/inverter-snapshot.ts` | Add optional `stack` to `BatterySnapshot` |
| Register definitions | Add BAMS, BCU, BMU register lookups |

## Testing

- Unit tests for BCU/BMU register parsing with mock register data
- Unit tests for snapshot building from HV register caches
- Unit tests verifying LV path is unchanged
- Tests documenting quirks: 24 vs 16 cells, register offset `60 + (120 x bcu_index)`, BAMS discovery
