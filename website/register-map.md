# GivEnergy Gen3 Hybrid — Register Map

Register names and meanings taken from the official GivEnergy app's **Direct Control** screen,
cross-checked against a live Modbus dump of the same inverter.

| | |
|---|---|
| Inverter | Gen3 Hybrid 5 kW, serial `FD2308F***`, app model label "GEN1/2/3 5KW" |
| Firmware | DSP 316, ARM 316 (HR 19 / HR 21), Modbus version 140 (HR 34) |
| Battery | Lithium (HR 54 = 1), capacity 186 Ah (HR 55), BMS firmware 4009 (HR 18) |
| Meter | One GivEnergy meter on slave `0x01` (meter type 33, fw 518) |
| App screenshots | 2026-11-19 22:18 – 22:23 |
| Modbus dump | 2026-11-19 22:25:47 (`scripts/dump-registers.mjs`, plus a full HR 0–599 / IR 0–299 scan with `scripts/full-scan.mjs`) |

**Legend for the "Match" column:**
- ✅ the dump value equals what the app showed
- ≈ live value that drifted between the screenshot and the dump
- 🔶 derived/inferred, not a single register
- ❌ unreadable

All Control registers are **holding registers (HR, fc=3, slave 0x11)**.
Times are encoded as `HHMM` decimal (e.g. `2330` = 23:30).

---

## 1. Control (holding registers, writable)

### General

| HR | App name | Type / range | App value | Raw | Match | Notes |
|---:|---|---|---|---:|:-:|---|
| 20 | Enable AC Charge Upper % Limit | toggle | off | 0 | ✅ | GivTCP: `enable_charge_target` (a.k.a. winter mode). Gates HR 116. |
| 27 | Enable Eco Mode | toggle | on | 1 | ✅ | |
| 29 | Battery Calibration | select | Stop | 0 | ✅ | GivTCP: `soc_force_adjust`. 0 = Stop. |
| 59 | Enable DC Discharge | toggle | off | 0 | ✅ | Enables timed discharge slots. |
| 96 | AC Charge Enable | toggle | on | 1 | ✅ | Enables AC charge slots. |
| 110 | Battery Reserve % Limit | 4–100 % | 4 % | 4 | ✅ | |
| 111 | Battery Charge Rate | 0–50 (C/100) | 50 | 50 | ✅ | Max charge rate as a % of C rating (unit C/100). Also capped by inverter max power. |
| 112 | Battery Discharge Rate | 0–50 (C/100) | 50 | 50 | ✅ | Same as 111 for discharge. |
| 114 | Battery Cutoff % Limit | 0–100 % | 4 % | 4 | ✅ | GivTCP label `battery_discharge_min_power_reserve` is misleading: this is a SOC %. |
| 163 | Restart Inverter | number | 0 | 0 | ✅ | Write to reboot. |
| 166 | Real-Time Control | toggle | off | 0 | ✅ | GivTCP calls this `rtc_enable`. |
| 172 | Enable Manual Battery Heater | toggle | off | 0 | ✅ | Not in GivTCP map. |

### Inverter

| HR | App name | Type / range | App value | Raw | Match | Notes |
|---:|---|---|---|---:|:-:|---|
| 50 | Inverter Max Output Active Power Percent | 0–100 % | 100 % | 100 | ✅ | GivTCP: `active_power_rate`. |
| 199 | Enable Inverter Parallel Mode | toggle | off | 0 | ✅ | **GivTCP labels this `enable_standard_self_consumption_logic`; the official app says parallel mode.** |
| 311 | Export Power Priority | number | 0 | 0 | ✅ | Not in GivTCP map. Value semantics unknown. |
| 317 | Enable EPS | toggle | on | 1 | ✅ | Not in GivTCP map. |
| 479 | DC Wind CVT Voltage | number | 0 | 0 | ✅ | Not in GivTCP map. |
| 540 | Enable Smart Load | toggle | — | — | ❌ | Greyed out in app. |
| 541 | Smart Load Control SOC | 50–100 % | failed | — | ❌ | |
| 542 | Enable General Load | — | failed | — | ❌ | |
| 543 | General Load Control SOC | 50–100 % | failed | — | ❌ | |
| 544 | Generator Control SOC | 10–90 % | failed | — | ❌ | |
| 545 | Generator Voltage Min | number | failed | — | ❌ | |
| 546 | Generator Voltage Max | number | failed | — | ❌ | |
| 547 | Generator Frequency Min | number | failed | — | ❌ | |
| 548 | Generator Frequency Max | number | failed | — | ❌ | |
| 552 | Smart Load Export Power | number | failed | — | ❌ | |
| 553 | Smart Load Delay Time | number | failed | — | ❌ | |
| 554–573 | Smart Load Start/End Time 1–10 | time | failed | — | ❌ | Pairs: start = 554 + 2(n−1), end = 555 + 2(n−1). |

HR 540–573 are **not implemented on this inverter**: the app shows "Failed to read register"
and a Modbus read of HR 540–599 times out. These are probably for newer models (e.g. All-in-One / Gen4).

### Battery

| HR | App name | Type / range | App value | Raw | Match | Notes |
|---:|---|---|---|---:|:-:|---|
| 104 | Enable Battery Self-Heating | toggle | off | 0 | ✅ | Not in GivTCP map. |
| 313 | Inverter Charge Power Percentage | 0–100 % | 100 % | 100 | ✅ | GivTCP: `battery_charge_limit_ac`. |
| 314 | Inverter Discharge Power Percentage | 0–100 % | 100 % | 100 | ✅ | GivTCP: `battery_discharge_limit_ac`. |

### Grid

| HR | App name | Type / range | App value | Raw | Match | Notes |
|---:|---|---|---|---:|:-:|---|
| 331 | Force Off Grid | toggle | off | 0 | ✅ | Not in GivTCP map. |

### Charge & discharge schedules

The app reports: *"This inverter supports 10 charge and 10 discharge slots."*

| HR | App name | Type / range | App value | Raw | Match |
|---:|---|---|---|---:|:-:|
| 116 | AC Charge Upper % Limit (global) | 0–100 % | 100 % | 100 | ✅ |
| 318 | Pause Battery | select | Pause Off | 0 | ✅ |
| 319 | Pause Battery Start Time | time | 00:00 | 0 | ✅ |
| 320 | Pause Battery End Time | time | 00:00 | 0 | ✅ |

HR 318 values (GivTCP): 0 = off, 1 = pause charge, 2 = pause discharge, 3 = pause both.

**AC charge slots** (start / end / "Upper SOC % Limit", 0–100 %):

| Slot | Start | End | Upper SOC | App value (start / end / SOC) | Match |
|---:|---:|---:|---:|---|:-:|
| 1 | 94 | 95 | 242 | 23:30 / 05:30 / 100 % | ✅ |
| 2 | 243 | 244 | 245 | 00:00 / 00:00 / 100 % | ✅ |
| 3 | 246 | 247 | 248 | 00:00 / 00:00 / 69 % | ✅ |
| 4 | 249 | 250 | 251 | 00:00 / 00:00 / 100 % | ✅ |
| 5 | 252 | 253 | 254 | 00:00 / 00:00 / 100 % | ✅ |
| 6 | 255 | 256 | 257 | 00:00 / 00:00 / 100 % | ✅ |
| 7 | 258 | 259 | 260 | 00:00 / 00:00 / 100 % | ✅ |
| 8 | 261 | 262 | 263 | 00:00 / 00:00 / 100 % | ✅ |
| 9 | 264 | 265 | 266 | 00:00 / 00:00 / 100 % | ✅ |
| 10 | 267 | 268 | 269 | 00:00 / 00:00 / 100 % | ✅ |

**DC discharge slots** (start / end / "Lower SOC % Limit", 4–100 %):

| Slot | Start | End | Lower SOC | App value (start / end / SOC) | Match |
|---:|---:|---:|---:|---|:-:|
| 1 | 56 | 57 | 272 | 00:00 / 00:00 / 40 % | ✅ |
| 2 | 44 | 45 | 275 | 00:00 / 00:00 / 50 % | ✅ |
| 3 | 276 | 277 | 278 | 00:00 / 00:00 / 4 % | ✅ |
| 4 | 279 | 280 | 281 | 00:00 / 00:00 / 4 % | ✅ |
| 5 | 282 | 283 | 284 | 00:00 / 00:00 / 4 % | ✅ |
| 6 | 285 | 286 | 287 | 00:00 / 00:00 / 4 % | ✅ |
| 7 | 288 | 289 | 290 | 00:00 / 00:00 / 4 % | ✅ |
| 8 | 291 | 292 | 293 | 00:00 / 00:00 / 4 % | ✅ |
| 9 | 294 | 295 | 296 | 00:00 / 00:00 / 4 % | ✅ |
| 10 | 297 | 298 | 299 | 00:00 / 00:00 / 4 % | ✅ |

Discharge slots 1 and 2 keep their legacy time registers (56/57 and 44/45), but their SOC
limits live in the Gen3 block (272, 275). `givenergy-modbus`'s `DISCHARGE_SLOT_REGISTERS`
already matches this. **HR 273 / 274 are not exposed by the app.** GivTCP-derived labels
called 272/273 `discharge_slot_1_start/end (gen3)`; that is wrong, since 272 is the slot 1 SOC limit.
The legacy charge-slot-2 registers HR 31/32 read `1` / `4` on this unit, and the app doesn't show them.

---

## 2. Read Only (input registers)

The app shows no register numbers on this tab. Each value was matched by comparing the app
reading (22:22:30) against the dump (22:25:47). Input registers are fc=4, slave 0x11.
"Total" values are 32-bit (`hi * 65536 + lo`). Signed values are int16.

| App name | App value | Source | Scale | Dump value | Match |
|---|---|---|---|---|:-:|
| Inverter serial | FD2308F*** | HR 13–17 (ASCII, 2 chars/register) | — | FD2308F*** | ✅ |
| Model | GEN1/2/3 5KW | HR 0 device type `0x2001` | — | 0x2001 | 🔶 2001 → 5 kW hybrid (as in GivTCP) |
| Solar generation | 0 W | IR 18 + IR 20 (`p_pv1 + p_pv2`) | 1 W | 0 + 0 | ✅ 🔶 |
| Grid power (net) | −375 W, importing | IR 30 `p_grid_out` | int16 W, negative = import | −367 | ≈ |
| Grid voltage | 239.0 V | IR 5 `v_ac1` | ÷10 | 239.6 | ≈ |
| Consumption | 316 W | IR 42 `p_load_demand` | 1 W | 307 | ≈ |
| Battery power | 0 W, Idle | IR 52 `p_battery` | int16 W | 0 | ✅ |
| Battery state of charge | 5.0 % | IR 59 `battery_percent` | 1 % | 5 | ✅ |
| PV generation today | 3.31 kWh | IR 17 + IR 19 | ÷10 | 3.3 | 🔶 app shows 0.01 more; no register holds 331 |
| PV string 1 today | 1.60 kWh | IR 17 `e_pv1_day` | ÷10 | 1.6 | ✅ |
| PV string 2 today | 1.70 kWh | IR 19 `e_pv2_day` | ÷10 | 1.7 | ✅ |
| Grid import today | 46.50 kWh | IR 26 `e_grid_in_day` | ÷10 | 46.6 | ≈ (importing ~370 W meanwhile) |
| Grid export today | 0.20 kWh | IR 25 `e_grid_out_day` | ÷10 | 0.2 | ✅ |
| Battery charge today | 11.00 kWh | IR 36 | ÷10 | 11.0 | ✅ |
| Battery discharge today | 13.80 kWh | IR 37 | ÷10 | 13.8 | ✅ |
| Consumption today | 49.81 kWh | import − export + IR 44 − IR 35 | ÷10 | ≈ 49.8–49.9 | 🔶 derived |
| AC charge today | 11.70 kWh | IR 35 (`e_inverter_in_day`) | ÷10 | 11.7 | ✅ |
| PV generation total | 14515.80 kWh | IR 11:12 `e_pv_total` | ÷10 | 14515.8 | ✅ |
| Grid import total | 16075.30 kWh | IR 32:33 `e_grid_in_total` | ÷10 | 16075.4 | ≈ |
| Grid export total | 8452.20 kWh | IR 21:22 `e_grid_out_total` | ÷10 | 8452.2 | ✅ |
| Consumption total | 20729.80 kWh | import − export + IR 45:46 − IR 27:28 | ÷10 | 16075.3 − 8452.2 + 17125.1 − 4018.4 = **20729.8** | ✅ 🔶 derived |
| AC charge total | 4018.40 kWh | IR 27:28 (`e_inverter_in_total`) | ÷10 | 4018.4 | ✅ |
| Grid voltage L1 | 239.0 V | IR 5 (meter IR 60 = 239.3) | ÷10 | 239.6 | ≈ |
| PV string 1 voltage | 12.4 V | IR 1 `v_pv1` | ÷10 | 12.3 | ≈ |
| PV string 2 voltage | 10.3 V | IR 2 `v_pv2` | ÷10 | 10.2 | ≈ |
| Battery voltage | (cut off in screenshot) | IR 50 `v_battery` | ÷100 | 50.65 V | — |

Takeaways:
- "AC charge" in the app is GivTCP's `e_inverter_in_*` (IR 35 today, IR 27:28 total).
- The app derives "Consumption" energy as
  `grid import − grid export + inverter out (IR 44 / IR 45:46) − AC charge (IR 35 / IR 27:28)`.
  The totals match exactly. The "today" value is 0.01 kWh off, which suggests the app keeps its own
  finer-grained running value.
- The Read Only tab goes on below "Battery voltage", and those entries aren't covered here.

---

## 3. Other observations from the dump (not shown in the app)

- **HR 480–516 mirrors other values**: 486/487 = charge slot 1 times (2330/530),
  489 = 100, 507 ≈ IR 3 (P-bus V), 508 ≈ IR 15, 511 ≈ IR 50 (battery V),
  493 ≈ IR 58 (grid port current), 497 = int16 −59 ≈ IR 24 (inverter output power),
  512 = 186 (= HR 55 capacity), 513 = 4 (= HR 110), 514/515 = 100 (= HR 313/314), 516 = 50 (= HR 111).
- **HR 300–328 contain non-zero values that haven't been identified** (e.g. 302 = 5000, 303/312 = 15000, 306 = 6000,
  307 = 2300, 308 = 3600, 315 = 1150, 316 = 2760, 321 = 5040, 326 = 4980, 327 = 40, 328 = 5010).
  Some look like voltage/frequency protection limits. Of these, the app exposes only 311, 313, 314, 317, 318–320.
- **The battery BMS (IR fc=4, slave 0x32, base 60)** responds. IR 60–75 are 16 cell voltages in mV (3.104–3.144 V),
  IR 76–79 are temperatures ÷10 (18.5–19.5 °C), and IR 110–114 hold the battery serial in ASCII.

---

## 4. Open questions

These are recorded rather than guessed at. Corrections from other Gen3 owners are welcome.

- **What do the values in HR 300–328 mean?** Apart from 311, 313, 314, 317 and 318–320, the app
  doesn't expose them. Some of the values in section 3 look like voltage or frequency protection
  limits, but none has been confirmed.
- **Why do HR 480–516 mirror other registers?** Several values repeat holding registers (charge
  slot 1 times, HR 55, HR 110, HR 111, HR 313/314) or track live input registers (IR 3, 15, 24, 50, 58).
  It is not known whether this block is a read-only status copy, a second register map used by newer
  firmware, or something else, nor whether writing to it has any effect.
- **Why are "PV generation today" and "Consumption today" 0.01 kWh off?** The app shows 3.31 kWh and
  49.81 kWh, but the registers have a resolution of 0.1 kWh (IR 17 + IR 19 = 3.3; the derived consumption is
  ≈ 49.8–49.9). No register read so far holds the extra digit. The app might accumulate its own value,
  or read it from the cloud, or from a register outside the scanned ranges (HR 0–599, IR 0–299).
- **What do 273 / 274 do?** They sit inside the Gen3 discharge slot block but the app doesn't show them.
- **What does HR 311 "Export Power Priority" accept?** The app shows a plain number (0 here) with no
  range or option list.
