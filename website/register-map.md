# GivEnergy Gen3 Hybrid — Register Map

Register names and meanings taken from the official GivEnergy app's **Direct Control** screen,
cross-checked against a live Modbus dump of the same inverter.

| | |
|---|---|
| Inverter | Gen3 Hybrid 5 kW, serial redacted, app model label "GEN1/2/3 5KW" |
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
| 199 | Enable Inverter Parallel Mode | toggle | off | 0 | ✅ | **GivTCP labels this `enable_standard_self_consumption_logic`; the official app says parallel mode**, for All in One units running in parallel with a Gateway. |
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
and a Modbus read of HR 540–599 times out. They belong to the Gateway 2 used with the All in One 2 (see [section 4](#smart-load-general-load-and-generator-hr-540–573)).

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
| Inverter serial | (redacted) | HR 13–17 (ASCII, 2 chars/register) | — | (redacted) | ✅ |
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
| Battery voltage | 50.6 V | IR 50 `v_battery` | ÷100 | 50.64 | ✅ |
| Inverter temperature | 28.9 °C | IR 41 `temp_inverter_heatsink` | ÷10 | 28.9 | ✅ |
| Battery temperature | 19.0 °C | IR 56 `temp_battery` | ÷10 | 19.0 | ✅ |
| Charger temperature | 28.3 °C | IR 55 `temp_charger` | ÷10 | 27.8 | ≈ |

Takeaways:
- "AC charge" in the app is GivTCP's `e_inverter_in_*` (IR 35 today, IR 27:28 total).
- The app derives "Consumption" energy as
  `grid import − grid export + inverter out (IR 44 / IR 45:46) − AC charge (IR 35 / IR 27:28)`.
  The totals match exactly. The "today" value is 0.01 kWh off, which suggests the app keeps its own
  finer-grained running value.
- The temperature values are from the full scan at 22:28, a few minutes after the app screenshots.

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

## 4. What the settings do (from GivEnergy and community sources)

This section says what the settings *do*, which the register dump can't show. Each claim is
tagged with how strong its source is:

- **[manual]**: GivEnergy's own documentation
- **[library]**: another open-source integration's documentation
- **[maintainer]**: knowledge from this project's maintainer, not yet backed by a written source
- **[forum]**: a post on the GivEnergy Community Forum, read from a Wayback Machine snapshot
  (the forum is no longer reachable). Unless noted, posters are ordinary users.

Claims marked [forum] are reports from individual owners, not confirmed behaviour.

### Battery Reserve vs Battery Cutoff (HR 110 / HR 114)

- **[library]** `givenergy-local` describes Battery Cutoff % (HR 114) as the setting that
  *"sets the minimum allowable battery SOC during battery discharge"*, and says of Battery Reserve %
  (HR 110): *"Despite the name, this does not set a minimum SOC under normal conditions"*, noting a
  GivEnergy document suggests it only matters for systems with EPS configured.<sup>[3]</sup>
- **[forum]** An All in One owner with Reserve 10 % and Cutoff 15 % found the battery *"will not drop
  below 15%"*, so the higher of the two stopped discharge. They passed on advice that *"the Cutoff is to
  protect the battery and should be set lower e.g. 4%. The Reserve is your buffer for power outages."*
  Two other owners report both set to 4 %, as on the reference unit.<sup>[5]</sup>
- **[forum]** Another owner warns that discharge slots' lower SOC limits can act as *"an unofficial
  reserve"* if they are set above 4 %.<sup>[7]</sup>

On the reference unit both are 4 %, so the dump can't tell them apart.

### AC Charge Upper % Limit and Eco Mode (HR 20 / HR 116 / HR 27)

- **[library]** HR 116 *"sets the target battery percentage when charging from the grid"*, and the
  HR 20 toggle decides whether that percentage *"is actually respected or simply ignored"*.<sup>[3]</sup>
- **[library]** With Eco Mode (HR 27) on, *"the battery will only discharge to match demand. No energy
  will be exported."* With it off, the battery discharges at maximum power.<sup>[3]</sup>

### Battery Calibration (HR 29)

- **[manual]** GivEnergy describes calibration as correcting State of Charge drift. There are two
  kinds: a *soft* calibration (a full discharge then a full charge through normal use) and a *full*
  calibration started from a "Calibrate Battery" button in the portal, which *"forces the system to
  re-evaluate its internal energy model"*.<sup>[2]</sup> The guide doesn't list the app's option
  values. Only 0 = Stop has been seen on the device.

### Timed charge, discharge and export

- **[manual]** Charge slots can't cross midnight, so a 23:30–05:30 tariff is split into two slots.
  Timed Discharge is overridden by Timed Charge and Timed Export. Once a discharge slot reaches its
  target SOC, the system falls back to the grid but still charges from surplus solar.<sup>[4]</sup>
  The reference unit's charge slot 1 is 23:30–05:30 (HR 94/95), which the app accepts as one slot,
  so the midnight rule may not apply to Gen3 firmware 316. This is unverified.

### Inverter Charge/Discharge Power Percentage (HR 313 / HR 314)

- **[forum]** The owner of a Gen3 5 kW Hybrid, the same model as the reference unit, set GivTCP's
  "Battery charge rate AC" (HR 313, this app's "Inverter Charge Power Percentage") to 60 %. Grid charging
  then ran at about 2 kW, roughly 60 % of 3.6 kW, while solar charging later reached 3 kW. That fits
  another reply's recollection that the percentage setting *"only impacts AC charging"*.<sup>[6]</sup>
- **[forum]** The same thread says "Inverter Max Output Active Power Percent" (HR 50) limits the whole
  inverter, *"including what it supplies to the house"*. At 50 %, a 5 kW hybrid behaves as a 2.5 kW
  inverter.<sup>[6]</sup>

### Export Power Priority (HR 311)

- **[forum]** In the portal this setting is a choice that includes *"Load first"*, which an experienced
  user recommends but admits *"I have never really understood"*. They take it to mean the inverter meets
  house load before exporting. Another owner's setting showed blank.<sup>[7]</sup>
  The full list of options and how they map to register values is unknown. The reference unit reads 0,
  and the app shows it as a plain number.

### Force Off Grid (HR 331)

- **[forum]** An All in One owner found that turning it on *"turns the PV import off as well"*, every
  time, with the battery at 100 %. Another poster guesses PV only continues off-grid while the battery is
  under 80 %, and a third says off-grid running is limited to 6 kW sustained and that reconnecting to
  the grid was not always seamless.<sup>[8]</sup> Nothing confirms how it behaves on a Gen3 Hybrid.

### Smart Load, General Load and Generator (HR 540–573)

These settings belong to the **Gateway 2**, which pairs with the **All in One 2**. That explains why
the block times out on a Gen3 Hybrid. The All in One 2 manual describes the following behaviour
**[manual]**<sup>[1]</sup>:

- **Smart Load** is a switched output for large loads that don't need to run continuously, such as
  water heaters. It *"begins to work"* when surplus energy flowing to the grid *"is greater than
  1kW"*, and keeps running *"until the system energy demand is greater than the supply"*. It can be
  forced on or off.
- **General Load** is for large loads used often, such as air conditioning or heating. It is always on
  while on-grid. Off-grid, *"when the AIO2 battery SOC is lower than the set value, the general load
  stops working until the SOC is higher than the set value"*, which keeps energy back for critical
  loads. It can be forced on or off.
- **Generator**: when the grid is off and the battery is low, the Gateway 2 starts a remote-start
  generator below a configurable *start SOC*, and stops it at a *"cut-off SOC"*. Grid power always
  takes priority. The PV inverter does not run while the generator runs.

The app's register names line up with these descriptions, but **no register-level mapping has been
checked on a device that has a Gateway 2**. Going by name only:
HR 543 "General Load Control SOC" would be the general load's off-grid SOC,
HR 544 "Generator Control SOC" (10–90 %) would be the generator start SOC,
and HR 552 "Smart Load Export Power" might be the export threshold the manual gives as 1 kW.
No register for the generator's cut-off SOC was seen in the app.

**[forum]** A reply that another member addresses as part of the GivEnergy team describes the load
split in a power cut. With the critical-load SOC at its default 20 %, everything stays powered until
20 %, then only the critical load stays on. Setting it to 4 % makes general and critical loads behave
the same. The same reply says smart loads can be switched *"Manual setting on/off/auto"*, by *"timer
with scehdule"* (sic), or *"Auto on SOC reached eg 95%"*.<sup>[9]</sup> That matches the app's Smart Load
Control SOC (HR 541, 50–100 %) and the ten Smart Load start/end times (HR 554–573). It also suggests
HR 543 "General Load Control SOC" is this cutover SOC, although the app limits HR 543 to 50–100 %,
which doesn't fit a 20 % default. That remains unresolved.

### Inverter Parallel Mode (HR 199)

- **[maintainer]** This is for All in One units running in parallel with a Gateway. On a standalone
  Gen3 Hybrid it reads 0 (off). This contradicts GivTCP's label, `enable_standard_self_consumption_logic`.
  The app itself shows only the toggle, with no description.

### Not found in any source

HR 104 Battery Self-Heating, HR 172 Manual Battery Heater,
HR 166 Real-Time Control, HR 317 Enable EPS and HR 479 DC Wind CVT Voltage. GivTCP doesn't map any
of them either.

### Sources

1. GivEnergy, *All in One 2, MPPT Unit, Gateway 2, Expansion Battery User Manual*, V1 Oct 2025, pp. 11–12
   (copy hosted by distributor Segen):
   <https://portal.segen.co.uk/reseller/docs/All%20in%20One%202%20Manual.pdf>
2. GivEnergy, *How to Calibrate Your GivEnergy Battery*:
   <https://givenergy.com/resource-hub/customer-guides/how-to-calibrate-your-givenergy-battery/>
3. `givenergy-local` (Home Assistant integration), *controls.md*:
   <https://github.com/cdpuk/givenergy-local/blob/master/docs/controls.md>
4. GivEnergy, *Energy Management System Guide*:
   <https://givenergy.com/resource-hub/customer-guides/energy-management-system-guide/>
5. GivEnergy Community Forum, *Battery CutOff %?* (Wayback Machine snapshot):
   <https://web.archive.org/web/20260412202117/https://community-beta.givenergy.cloud/t/battery-cutoff/2540>
6. GivEnergy Community Forum, *Charge power from mains vs solar* (Wayback Machine snapshot):
   <https://web.archive.org/web/20260412201824/https://community-beta.givenergy.cloud/t/charge-power-from-mains-vs-solar/4941>
7. GivEnergy Community Forum, *Battery not discharging after pause using quick settings* (Wayback Machine snapshot):
   <https://web.archive.org/web/20260412233324/https://community-beta.givenergy.cloud/t/battery-not-discharging-after-pause-using-quick-settings/4158>
8. GivEnergy Community Forum, *Force off grid* (Wayback Machine snapshot):
   <https://web.archive.org/web/20260412201928/https://community-beta.givenergy.cloud/t/force-off-grid/2188>
9. GivEnergy Community Forum, *AIO-2 and Gateway-2 question* (Wayback Machine snapshot):
   <https://web.archive.org/web/20260412201924/https://community-beta.givenergy.cloud/t/aio-2-and-gateway-2-question/5012>

---

## 5. Open questions

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
  range or option list. The portal offers "Load first" among other options (section 4), but not how they map to values.
