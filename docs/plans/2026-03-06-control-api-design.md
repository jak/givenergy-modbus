# Control API Design

Replicate giv_tcp REST API functionality with cleaner naming and proper multi-generation support.

## Architecture

- Abstract `GivEnergyInverter` base class (EventEmitter)
- Subclasses: `Gen2Inverter`, `Gen3Inverter`, `ThreePhaseInverter`
- Factory: `GivEnergyInverter.connect(options)` connects, detects generation from serial prefix, returns subclass
- Discriminated union snapshots keyed on `generation` field

### Generation Detection

| Serial prefix | Class |
|---------------|-------|
| `CE` | Gen2Inverter |
| `EE` | Gen3Inverter |
| `SA` | ThreePhaseInverter |

## Shared API Surface (all generations)

| Method | Description |
|--------|-------------|
| `static connect(options)` | Factory — connects, detects type, returns subclass |
| `stop()` | Disconnect |
| `getData()` | Latest snapshot (generation-typed) |
| `setMode(mode)` | `'eco' \| 'timed_demand' \| 'timed_export'` |
| `setChargeScheduleEnabled(enabled)` | Enable/disable charging |
| `setDischargeScheduleEnabled(enabled)` | Enable/disable discharging |
| `setChargeSlot(slot, config)` | Set one charge timeslot |
| `setChargeSlots(configs[])` | Set all charge timeslots, zero the rest |
| `setDischargeSlot(slot, config)` | Set one discharge timeslot |
| `setDischargeSlots(configs[])` | Set all discharge timeslots, zero the rest |
| `setChargeTarget(percent)` | Global charge SOC target (4-100) |
| `setChargeRate(watts)` | Charge rate in watts |
| `setChargeRatePercent(percent)` | Charge rate as direct percentage |
| `setDischargeRate(watts)` | Discharge rate in watts |
| `setDischargeRatePercent(percent)` | Discharge rate as direct percentage |
| `setBatteryReserve(percent)` | Min SOC floor — won't discharge below this (4-100) |
| `setBatteryPowerReserve(percent)` | Discharge power reserve for loads (4-100) |
| `setDateTime(date)` | Set inverter clock — HR(35-40) |
| `syncDateTime()` | Convenience — calls setDateTime(new Date()) |
| `reboot()` | HR(163)=100 |
| `unsafe_writeRegister(register, value)` | Raw register write, no validation |

### Gen3-only methods

| Method | Description |
|--------|-------------|
| `setExportLimit(watts)` | Max export power — HR(2071), 0-65000 |
| `setBatteryPauseMode(mode)` | `'disabled' \| 'pause_charge' \| 'pause_discharge' \| 'pause_both'` — HR(318) |
| `setPauseSlot(config)` | Pause timeslot — HR(319-320) |

## Generation Differences

| | Gen2 | Gen3 | 3ph |
|--|------|------|-----|
| Charge slots | 1 | 1-10 with per-slot SOC target | 1-2 |
| Discharge slots | 1-2 | 1-10 with per-slot SOC target | 1-2 |
| Rate scaling | 0-50% | 0-50% | 0-100% |
| Charge enable | HR(96) | HR(96) | HR(1123) + HR(1112) |
| Discharge enable | HR(59) | HR(59) | HR(1122) |
| Charge target | HR(116) | HR(116) | HR(1111) |
| Charge rate % | HR(313) | HR(313) | HR(1110) |
| Discharge rate % | HR(314) | HR(314) | HR(1108) |
| Battery reserve | HR(110) | HR(110) | HR(1109) |
| Power reserve | HR(114) | HR(114) | HR(1078) |

### Charge/Discharge Slot Registers

**Gen2:**
- Charge: HR(94-95) slot 1 only
- Discharge: HR(56-57) slot 1, HR(44-45) slot 2

**Gen3:**
- Charge: HR(94-95) slot 1, HR(243-269) slots 2-10, HR(242-262 even) SOC targets
- Discharge: HR(56-57) slot 1, HR(273-299) slots 2-10, HR(272-292 even) SOC targets

**3ph:**
- Charge: HR(1113-1114) slot 1, HR(1115-1116) slot 2
- Discharge: HR(1118-1119) slot 1, HR(1120-1121) slot 2

## Snapshot Types

Discriminated union on `generation` field:

```ts
type InverterSnapshot = Gen2Snapshot | Gen3Snapshot | ThreePhaseSnapshot
```

- `Gen3Snapshot.chargeSlots` uses `Gen3TimeSlotConfig` which includes `targetStateOfCharge: number`
- `Gen2Snapshot.chargeSlots` and `ThreePhaseSnapshot.chargeSlots` use `TimeSlotConfig` (no SOC field)
- Same pattern for `dischargeSlots`

## Behaviour Rules

- `targetStateOfCharge` in slot config silently ignored on Gen2/3ph
- Slot number beyond generation max: runtime error
- Slots array too long for generation: runtime error
- SOC values validated 4-100
- Write methods throw if generation not yet detected (no data poll received)
- `setChargeSlots([])` zeros all slots
- Time strings validated as `HH:MM` 24-hour format
- Rate in watts converted to percentage internally using inverter rated power

## Renames from Current API

| Old | New | Reason |
|-----|-----|--------|
| `setTargetStateOfCharge` | `setChargeTarget` | Shorter, matches user expectations |
| `setEnableCharge` | `setChargeScheduleEnabled` | Clearer — enables the schedule, not charging itself |
| `setEnableDischarge` | `setDischargeScheduleEnabled` | Same |
| `new GivEnergyInverter() + start()` | `GivEnergyInverter.connect()` | Single call, returns correct subclass |
