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
| `hoursOfOperation` | `s.status.hoursOfOperation` | Single-phase only (IR 47–48). Optional: absent unless IR 47 and IR 48 were both read, and when over 100 years, which marks a bad read (the HV Gen3 capture reads 723 million hours). |

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
| `batteryDischargeEnergyTotalKwh` | `s.battery.energy.dischargeTotalKwh` | As above (no IR 29 fallback). Three-phase (IR 1390–1395) is optional the same way: absent when unread or when both read 0. Also no longer reads HR 180, which 2.x used as `discharge_total_2`: on the reference Gen3 HR 180–186 read 0x5858 ("XX"). The inverter fallback is IR 180 (input). |
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
| `temperatureMax` | `temperatureMax` | `temperatureMax` | Now signed. HV: over the module's sensor count from the BCU (IR 68 ÷ IR 64, 12 on every capture); 2.x took 24 values, including IR 102–113. |
| `temperatureMin` | `temperatureMin` | `temperatureMin` | Now signed. HV: as `temperatureMax`. |
| `cycleCount` | `cycleCount` | `s.battery.stacks[stack].cycleCount` | 2.x copied the stack's count onto every HV module. |
| `cellVoltages` | `cellVoltages` | `cellVoltages` | |
| `stack?` | — | `stack` | Required on HV modules, absent on LV. `stack` is the control unit's device address − 0x70 and `index` the module's address − 0x50, so a device that didn't answer leaves a gap instead of shifting the indexes after it (the register caches carry each device's index). |

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
| `consumptionEnergyTodayKwh` | `s.load.energyTodayKwh` | Single-phase: optional, absent on `ac`. The derived formula (import − export + IR 44 − AC charge) under-reads there because the PV inverter's generation never reaches IR 44: the AC capture gives −30.9 kWh today (2.x clamped it to 0) and 963.6 kWh in total against 12,292 kWh imported. Three-phase reads IR 1396–1397 directly and keeps it on `ac_3ph`. |
| `consumptionEnergyTotalKwh` | `s.load.energyTotalKwh` | As above (three-phase IR 1398–1399). |
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
| `chargeSlots` | `s.schedules.charge` | Always `TimeSlotConfig[]`; `targetStateOfCharge` is optional and present when `capabilities.perSlotTargets` (never on three-phase slots 1/2). Slot counts follow `capabilities.tenSlots`, not generation: 10, or 2 on legacy firmware (2.x Gen2 had 1 charge slot; slot 2 is HR 31/32). Three-phase now has 10 slots when `tenSlots` (2.x had 2). **Changed:** a slot whose start or end register is unread is left out, and so is an unread target; 2.x zero-filled them into `00:00`–`00:00` slots with 0 % targets (three-phase slots 3–10 and AC charge slot 1 on the captures). The full poll reads every slot register, so this only happens with partial data, and then array position no longer matches the slot number. |
| `dischargeSlots` | `s.schedules.discharge` | As above. |
| `batteryPauseMode` (Gen3) | `s.schedules.batteryPause.mode` | Single-phase only, optional (`capabilities.pauseMode`). Values renamed: `disabled` → `off`, `pause_charge` → `charge`, `pause_discharge` → `discharge`, `pause_both` → `both`. An unnamed HR 318 value is now `unknown` (2.x read it as `disabled`). |
| `timedDischargeSlot` (Gen3) | `s.schedules.batteryPause.start` / `.end` | Optional (`capabilities.pauseWindow`). **Fixed:** 2.x had HR 319/320 swapped; 3.x reads HR 319 as start and HR 320 as end, as the app shows them. |
| `TimeSlot` | `TimeSlotConfig` without `targetStateOfCharge` | `TimeSlot` is gone. |
| `TimeSlotConfig.targetStateOfCharge: number` | `TimeSlotConfig.targetStateOfCharge?: number` | Now optional. |
| `BatteryPauseMode` | `BatteryPause['mode']` | |

## Meters

`meters: MeterSnapshot[]` → `s.meters: Meter[]`. Fields are unchanged except:

| 2.x | 3.x | Notes |
|---|---|---|
| `serialNumber`, `factoryCode`, `meterType`, `hardwareVersion`, `softwareVersion` | same | Now optional: each is absent when its function 22 product registers (60–66) weren't read. 2.x zero-filled them (the Gen2 capture's meter never answers function 22). |
| `importReactiveEnergy` | `importReactiveEnergyKvarh` | Unit suffix added. |
| `exportReactiveEnergy` | `exportReactiveEnergyKvarh` | Unit suffix added. |
| `apparentPower`, `apparentPowerTotal` | same | Still raw VA, as in 2.x, but now unsigned (2.x read them signed, which wraps above 32767 VA). "Apparent power ÷10" (research C, the external library) was considered and rejected: on every capture single-phase V × I matches the raw value, and ÷10 would put three-phase apparent power below the active power. |
| `powerFactor`, `powerFactorTotal` | same | **Fixed (2.x bug, contradicts research C):** now raw ÷10000 − 1 (offset-unsigned). Research C and 2.x read signed ÷10000, which gives values above 1 on every capture (e.g. 1.998); the offset decoding matches \|active ÷ apparent\|. On a single-phase meter (phase 2 and 3 voltage 0) phases 2 and 3 are 0, not the −1 that raw 0 decodes to. |
| `current` | same | Unchanged (÷100). Quirk: the three-phase capture's meter 0x01 only fits ÷10; not special-cased. |
| `ThreePhase<T>` (mutable tuple) | `ThreePhase<T>` (readonly tuple) | |

## Design choices the migration guide should explain

- **Per-phase values are exact per group.** Three-phase `grid.phases` is
  `{ voltage, current, power }` (IR 1061–1066, IR 1083–1085), `inverter.phases` is
  `{ voltage, power }` (IR 1091–1096) and `eps.phases` is `{ voltage, current, power }`
  (IR 1181–1192). There is no `load.phases`. The inverter reports nothing else per phase, so no
  field is zero-filled. `ThreePhase<T>` is `readonly [T, T, T]` (L1, L2, L3), the same shape as
  the meter's per-phase values.
- **IR 1083–1085 are per-phase grid power, not load.** Research C names them per-phase load.
  An earlier Phase C decision dropped them because, on the three-phase capture, they read
  0 / −536 / +533 W against a 1636 W load. New evidence reverses that: they sum exactly to
  `grid.power` (−3 W), and each phase is the negation of meter 0x01's per-phase active power
  (0 / 537 / −534 W). They are `grid.phases[n].power`, signed W, with `grid.power`'s sign
  (positive is export).
- **Meter sign is as the meter reports it.** On the three-phase capture meter 0x01's total is
  +3 W while `grid.power` is −3 W; on Gen2 the meter (−4 W) and the grid CT are both negative.
  Meter values are not normalised to the grid sign convention.
- **Battery modules are a union on `kind`.** `'low_voltage'` modules come from each BMS
  (0x32–0x37); `'high_voltage'` modules (BMUs) carry `stack`, `index`, cell voltages and cell
  temperatures. The counts come from the stack's battery control unit: IR 67 ÷ IR 64 cell
  voltages (24 on every capture) and IR 68 ÷ IR 64 temperatures (12 on every capture; 2.x read
  24, including IR 102–113). Pack-level HV data (status, voltage, current, state of charge
  min/max, state of health, energy, capacities, cycles, alarm words; not power, see
  "Registers not exposed") lives in `s.battery.stacks[]`, one per battery control unit.
  `stack` and `index` come from device addresses, so a silent device leaves a gap. 2.x copied the stack's state of charge,
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
  count PV generation; on AC and All in One models they echo the AC side. On `ac` they miss the
  PV inverter's generation, so single-phase consumption isn't derived there (see EPS and load).

## Registers not exposed

| Register | Why |
|---|---|
| Single-phase IR 16 (power factor) | No decoding fits the captures. GivTCP's raw ÷10000 − 1 gives 0.098 on Gen1 while IR 24 delivers 3371 W, and −0.9 on AC and the All in One (raw 1000), where the All in One's IR 24 / IR 43 = 371 W / 369 VA put it near unity. Raw 10000 is 0, not unity, so an unread register can't default to 1 either. Exposed as `inverter.powerFactor` earlier in Phase C; removed. The CT meter's `powerFactor` is exposed. |
| Three-phase IR 1068 (power factor) | Scaling unknown. |
| Three-phase IR 1240–1241 (export power), IR 1244–1245 (meter 2 power), IR 1400–1403 (export 2 energy) | Meaning unknown. |
| LV battery IR 115 | Meaning unknown. |
| Meter product registers 67–68 (function 22) | The 2.x poll reads 60–68, but neither 2.x nor 3.x decodes 67–68; meaning unknown. |
| HV battery control unit IR 79 (stack power) | Unit unknown: GivTCP shows it ÷1000 as kW, but the captures read −3 and −16 while voltage × current is about −380 W and −1750 W. `voltage` and `current` are exposed. |
| HR 4141–4142 (inverter export total) | Not in any polled block. |

## Dropped

| 2.x | Why |
|---|---|
| `generation` | Replaced by `layout`, `model` and `capabilities`. |
| `TimeSlot` | Merged into `TimeSlotConfig` with an optional target. |

Every other 2.x field has a 3.x home above.
