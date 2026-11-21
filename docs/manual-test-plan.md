# Manual test plan: real inverter

Checks for a release against a real inverter, run with `scripts/try.mjs`. The automated
tests cover every model from wire captures, so this plan checks what they can't: real
timing, and the dongle's push mode and reconnects. It also checks that writes land and
the GivEnergy app agrees with them.

```sh
npm run build
npm run script:try -- <host> --read-only   # part 1
npm run script:try -- <host>               # part 2 (writes)
```

Leave out the host and the script finds the inverter itself. Each session writes a log to
`dumps/try-*.log`, which is gitignored because it can contain serials. Type `log` in the
console to see its path.

Console commands:

| Command | What it does |
| --- | --- |
| `charge <n>` / `discharge <n>` | Edits slot n. Enter `clear` at the start prompt to set it to 00:00–00:00. |
| `pause` | Sets the battery pause mode, and the window where the model supports one. |
| `set <key> <value>` | Writes a catalogue setting, for example `set ecoMode off`. |
| `settings` | Lists every setting with its value and what it accepts. |
| `sync-clock` | Sets the inverter clock to this computer's time. There is no undo. |
| `undo` | Puts back everything changed this session. Quitting offers it too. |
| `log`, `refresh`, `quit` | |

Every write shows the current and new value and is only sent after you type `y`. Unsafe
settings (heater, parallel mode, force off grid) and raw register writes are not offered.

Use **harmless values** for the write tests: a slot window that has already passed today,
or one in the middle of the night that undo will clear long before it starts. Have the
GivEnergy app open next to the console. After a write the app can take a minute or two to
show it. Pull to refresh.

## Part 1: read-only

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| R1 | Start with no host | It finds the inverter and prints "using <ip>" | |
| R2 | Time from start to the first panel | Under 30 s. 10–21 s seen before; 60 s seen on 2026-11-21 | |
| R3 | Model and firmware line | Matches the app's inverter details | |
| R4 | Battery state of charge, solar, grid and load | Within a few % / W of the app's live view (both move) | |
| R5 | Sign conventions | Battery + while discharging; grid + while exporting | |
| R6 | Charge and discharge slots | Same times and targets as the app's schedule screens | |
| R7 | Battery pause | Same mode and window as the app | |
| R8 | `settings` | Eco mode, battery reserve, charge and discharge rate, export priority etc. match the app | |
| R9 | Leave it running 30 min | "data updates" keeps rising; "last … s ago" stays under ~5 min | |
| R10 | Turn the computer's Wi-Fi off for 1–2 min, then on | "connection lost", "reconnecting", then "reconnected"; the panel updates again | |
| R11 | A write command in `--read-only` | "Read-only mode: writes are off." | |
| R12 | `quit` | Exits cleanly and prints the log path | |

## Part 2: writes

Run each test, check the app, then `undo` (or quit and accept the undo offer) and check the
app shows the original again.

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| W1 | Note the panel's slots and key settings before any write (screenshot, not committed) | | |
| W2 | `charge 2`: set a window that's already passed, e.g. 03:00–03:30, target 80 % | Panel shows it straight away; the app shows it | |
| W3 | `undo` | Slot 2 is back to its old value, in the panel and the app | |
| W4 | `discharge 2`: a window that's already passed, e.g. 03:00–03:30 | As W2 | |
| W5 | `undo` | As W3 | |
| W6 | `set ecoMode off` (or the opposite of its current value) | Panel and app show the new value | |
| W7 | `undo` | Back to the original | |
| W8 | `set batteryReserve <current + 1>` | Panel and app show it | |
| W9 | `undo` | Back to the original | |
| W10 | `pause`: mode `off`, keep the window | Mode is off. Note whether the app also shows the window cleared | |
| W11 | `pause`: set a window, e.g. 03:00–03:30, mode `both`, then `undo` | App shows the window, then the original | |
| W12 | Invalid input: `set batteryReserve 2`, `charge 99`, start `25:00` | Rejected with a message; nothing written (check the log) | |
| W13 | `sync-clock` when the clock is out by a few seconds or more | Panel clock shows this computer's time after the next update | |
| W14 | Make one change, then `quit` and answer `y` | Change undone before exit | |
| W15 | Leave it running 10 min after the writes | Still updating; no reconnect loop | |

## Record

| Date | Model / firmware | Library commit | Part 1 | Part 2 | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

Raise anything that fails as an issue. Leave out the serial number and the session log.
