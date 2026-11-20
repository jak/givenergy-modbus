# 2.x → 3.x snapshot field map

Input for `website/migration-v3.md` (Task 19). Every field of the 2.x `InverterSnapshot`,
`BatterySnapshot`, `MeterSnapshot`, `TimeSlot`/`TimeSlotConfig` and `PowerFlows`, with its
3.x path in `src/model/snapshot.ts`. `s` is an `InverterSnapshot`.

## Discriminant and layout

| 2.x | 3.x | Notes |
|---|---|---|
| `generation: 'gen2' \| 'gen3' \| 'three_phase'` | `s.layout`, `s.model`, `s.capabilities` | Generation is gone. `layout` (`'single_phase' \| 'three_phase'`) is the compile-time discriminant; `model` (e.g. `'hybrid_gen3'`) and `capabilities` (e.g. `tenSlots`, `pauseMode`) replace generation checks at runtime. |
| `Gen2Snapshot` / `Gen3Snapshot` | `SinglePhaseSnapshot` | |
| `ThreePhaseSnapshot` | `ThreePhaseSnapshot` | Same name, new shape. |

## Identity

| 2.x | 3.x | Notes |
|---|---|---|
| `serialNumber` | `s.identity.serialNumber` | |
| `modelCode` | `s.identity.deviceTypeCode` | Renamed: HR 0 is the device type code. |

## Status

| 2.x | 3.x | Notes |
|---|---|---|
| `systemTime` | `s.status.systemTime` | |
| `hoursOfOperation` | `s.status.hoursOfOperation` | Single-phase only (IR 47–48). Optional: absent when over 100 years, which marks a bad read (the HV Gen3 capture reads 723 million hours). |

## Solar

| 2.x | 3.x | Notes |
|---|---|---|
| `solarPower` | `s.solar.power` | |
| `pvString1Power` / `pvString2Power` | `s.solar.strings[0].power` / `[1].power` | `strings` is `[]` on AC and All in One models, whose PV registers echo the AC side. |
| `pvString1Voltage` / `pvString2Voltage` | `s.solar.strings[n].voltage` | |
| `pvString1Current` / `pvString2Current` | `s.solar.strings[n].current` | |
| `pvString1EnergyTodayKwh` / `pvString2EnergyTodayKwh` | `s.solar.strings[n].energyTodayKwh` | |
| `pvEnergyTodayKwh` | `s.solar.energyTodayKwh` | |
| `pvEnergyTotalKwh` | `s.solar.energyTotalKwh` | |

## Battery

| 2.x | 3.x | Notes |
|---|---|---|
| `batteryPower` | `s.battery.power` | Sign unchanged: positive is discharging. |
| `batteryVoltage` | `s.battery.voltage` | |
| `batteryCurrent` | `s.battery.current` | |
| `stateOfCharge` | `s.battery.stateOfCharge` | |
| `batteryTemperature` | `s.battery.temperature` | Single-phase only. Now read as signed. |
| `chargerTemperature` | `s.battery.chargerTemperature` | Single-phase only. Now read as signed. |
| `batteryChargeEnergyTodayKwh` | `s.battery.energy.chargeTodayKwh` | Gen1 now reads IR 183 instead of IR 36. |
| `batteryDischargeEnergyTodayKwh` | `s.battery.energy.dischargeTodayKwh` | Gen1 now reads IR 182 instead of IR 37. |
| `batteryChargeEnergyTotalKwh` | `s.battery.energy.chargeTotalKwh` | Now optional: absent when every battery source reads 0. No longer reads HR 4109–4112 (write-only seeds) or falls back to IR 27–28 (the AC charge total), and LV module totals are no longer summed across packs. |
| `batteryDischargeEnergyTotalKwh` | `s.battery.energy.dischargeTotalKwh` | As above (no IR 29 fallback). Also no longer reads HR 180, which 2.x used as `discharge_total_2`: on the reference Gen3 HR 180–186 read 0x5858 ("XX"). The inverter fallback is IR 180 (input). |
| `batteryThroughputTotalKwh` | `s.battery.energy.throughputTotalKwh` | Optional: single-phase only. |
| `batteries: BatterySnapshot[]` | `s.battery.modules: BatteryModule[]` | `BatteryModule` is discriminated on `kind: 'low_voltage' \| 'high_voltage'`. |

### `BatterySnapshot` → `BatteryModule`

| 2.x | 3.x (low voltage) | 3.x (high voltage) | Notes |
|---|---|---|---|
| `serialNumber` | `serialNumber` | `serialNumber` | |
| `stateOfCharge` | `stateOfCharge` | `s.battery.stacks[stack].stateOfChargeMax` / `stateOfChargeMin` | 2.x copied the stack's maximum onto every HV module. |
| `voltage` | `voltage` | `s.battery.stacks[stack].voltage` | 2.x copied the stack voltage onto every HV module. |
| `dischargeEnergyTotalKwh` | `dischargeTotalKwh` | `s.battery.stacks[stack].energy.dischargeTotalKwh` | 2.x reported 0 on HV modules. |
| `chargeEnergyTotalKwh` | `chargeTotalKwh` | `s.battery.stacks[stack].energy.chargeTotalKwh` | 2.x reported 0 on HV modules. |
| `temperatureMax` | `temperatureMax` | `temperatureMax` | Now signed. |
| `temperatureMin` | `temperatureMin` | `temperatureMin` | Now signed. |
| `cycleCount` | `cycleCount` | `s.battery.stacks[stack].cycleCount` | 2.x copied the stack's count onto every HV module. |
| `cellVoltages` | `cellVoltages` | `cellVoltages` | |
| `stack?` | — | `stack` | Required on HV modules, absent on LV. |

## Grid

| 2.x | 3.x | Notes |
|---|---|---|
| `gridPower` | `s.grid.power` | IR 30, the grid CT. Positive is export. |
| `gridVoltage` | `s.grid.voltage` | Single-phase. Three-phase: `s.grid.phases[n].voltage`. |
| `gridFrequency` | `s.grid.frequency` | |
| `gridApparentPower` | `s.inverter.apparentPower` | Moved: IR 43 is measured at the inverter's AC terminal, not the grid CT. |
| `gridImportEnergyTodayKwh` | `s.grid.energy.importTodayKwh` | |
| `gridExportEnergyTodayKwh` | `s.grid.energy.exportTodayKwh` | |
| `gridImportEnergyTotalKwh` | `s.grid.energy.importTotalKwh` | |
| `gridExportEnergyTotalKwh` | `s.grid.energy.exportTotalKwh` | |

## Inverter

| 2.x | 3.x | Notes |
|---|---|---|
| `inverterOutputPower` | `s.inverter.outputPower` | |
| `inverterCurrent` | `s.inverter.current` | Single-phase only (IR 10). |
| `inverterHeatsinkTemp` | `s.inverter.heatsinkTemperature` | Now read as signed. |

## EPS and load

| 2.x | 3.x | Notes |
|---|---|---|
| `epsBackupPower` | `s.eps.power` | |
| `epsBackupVoltage` | `s.eps.voltage` | Single-phase. Three-phase: `s.eps.phases[n].voltage`. |
| `epsBackupFrequency` | `s.eps.frequency` | |
| `loadPower` | `s.load.power` | |
| `consumptionEnergyTodayKwh` | `s.load.energyTodayKwh` | |
| `consumptionEnergyTotalKwh` | `s.load.energyTotalKwh` | |
| `powerFlows` | `s.powerFlows` | `PowerFlows` is unchanged. |

## Settings

Settings come from the catalogue. Names follow the official app.

| 2.x | 3.x | Notes |
|---|---|---|
| `ecoMode` | `s.settings.ecoMode` | |
| `timedExport` | `s.settings.dcDischarge` | HR 59 (three-phase HR 1122): the app's "Enable DC Discharge". |
| `timedCharge` | `s.settings.acCharge` | HR 96 (three-phase HR 1112): the app's "AC Charge Enable". |
| `chargeTargetStateOfCharge` | `s.settings.acChargeUpperLimit` | HR 116 (three-phase HR 1111). |
| `batteryReservePercent` | `s.settings.batteryReserve` | |
| `chargeRatePercent` | `s.settings.inverterChargePowerPercent` | Optional: absent when the model lacks the HR 300 block. |
| `dischargeRatePercent` | `s.settings.inverterDischargePowerPercent` | Optional, as above. |

## Schedules

| 2.x | 3.x | Notes |
|---|---|---|
| `chargeSlots` | `s.schedules.charge` | Always `TimeSlotConfig[]`; `targetStateOfCharge` is optional and present when `capabilities.perSlotTargets`. |
| `dischargeSlots` | `s.schedules.discharge` | As above. |
| `batteryPauseMode` (Gen3) | `s.schedules.batteryPause.mode` | Single-phase only, optional (`capabilities.pauseMode`). Values renamed: `disabled` → `off`, `pause_charge` → `charge`, `pause_discharge` → `discharge`, `pause_both` → `both`. |
| `timedDischargeSlot` (Gen3) | `s.schedules.batteryPause.start` / `.end` | Optional (`capabilities.pauseWindow`). **Fixed:** 2.x had HR 319/320 swapped; 3.x reads HR 319 as start and HR 320 as end, as the app shows them. |
| `TimeSlot` | `TimeSlotConfig` without `targetStateOfCharge` | `TimeSlot` is gone. |
| `TimeSlotConfig.targetStateOfCharge: number` | `TimeSlotConfig.targetStateOfCharge?: number` | Now optional. |
| `BatteryPauseMode` | `BatteryPause['mode']` | |

## Meters

`meters: MeterSnapshot[]` → `s.meters: Meter[]`. Fields are unchanged except:

| 2.x | 3.x | Notes |
|---|---|---|
| `importReactiveEnergy` | `importReactiveEnergyKvarh` | Unit suffix added. |
| `exportReactiveEnergy` | `exportReactiveEnergyKvarh` | Unit suffix added. |
| `apparentPower`, `apparentPowerTotal` | same | **Fixed:** now ÷10 (2.x read them raw). |
| `ThreePhase<T>` (mutable tuple) | `ThreePhase<T>` (readonly tuple) | |

## Design choices the migration guide should explain

- **Per-phase values are exact per group.** Three-phase `grid.phases` is `{ voltage, current }`
  (IR 1061–1066), `inverter.phases` is `{ voltage, power }` (IR 1091–1096), `eps.phases` is
  `{ voltage, current, power }` (IR 1181–1192) and `load.phases` is `{ power }` (IR 1083–1085).
  The inverter reports nothing else per phase, so no field is zero-filled. `ThreePhase<T>` is
  `readonly [T, T, T]` (L1, L2, L3), the same shape as the meter's per-phase values.
- **Battery modules are a union on `kind`.** `'low_voltage'` modules come from each BMS
  (0x32–0x37); `'high_voltage'` modules (BMUs) carry `stack`, `index`, 24 cell voltages and
  24 cell temperatures. Pack-level HV data (status, voltage, current, power, state of charge
  min/max, state of health, energy, capacities, cycles, alarm words) lives in
  `s.battery.stacks[]`, one per battery control unit. 2.x copied the stack's state of charge,
  voltage and cycle count onto every HV module; 3.x copies nothing.
- **Three-phase battery voltage** is IR 1133, the inverter side, matching single-phase IR 50.
  The BMS reading, IR 1131, is `s.battery.batteryManagementSystemVoltage`. Three-phase has no
  battery temperature register: IR 1128/1129/1130 are `s.inverter.heatsinkTemperature`,
  `boostTemperature` and `buckBoostTemperature`.
- **Grid vs inverter terminal.** On single-phase, `s.grid` holds only the grid CT power
  (IR 30), voltage (IR 5, measured at the inverter terminal on the same AC bus), frequency
  (IR 13) and energy. IR 43 (apparent power) and IR 58 (current) are measured at the
  inverter's AC terminal, so they are `s.inverter.apparentPower` and
  `s.inverter.terminalCurrent`. There is no `grid.current`; the CT meter has per-phase current.
- **IR 44–46** are `s.inverter.energy.outputTodayKwh` / `outputTotalKwh`. On DC hybrids they
  count PV generation; on AC and All in One models they echo the AC side.

## Registers not exposed

| Register | Why |
|---|---|
| Three-phase IR 1083–1085 (per-phase load in research C) | On the three-phase capture they read 0 / −536 / 533 W against a 1636 W total, so they can't be per-phase load. `ThreePhaseLoad` has no `phases`. |
| Three-phase IR 1068 (power factor) | Scaling unknown. |
| Three-phase IR 1240–1241 (export power), IR 1244–1245 (meter 2 power), IR 1400–1403 (export 2 energy) | Meaning unknown. |
| LV battery IR 115 | Meaning unknown. |
| HR 4141–4142 (inverter export total) | Not in any polled block. |

## Dropped

| 2.x | Why |
|---|---|
| `generation` | Replaced by `layout`, `model` and `capabilities`. |
| `TimeSlot` | Merged into `TimeSlotConfig` with an optional target. |

Every other 2.x field has a 3.x home above.
