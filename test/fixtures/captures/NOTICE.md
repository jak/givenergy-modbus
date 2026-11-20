# Wire capture fixtures: notice

The `.log` files in this directory are real GivEnergy wire captures from the
`tests/fixtures/captures/` directory of
[dewet22/givenergy-modbus](https://github.com/dewet22/givenergy-modbus).

- Copyright (c) 2021 Dewet Diener
- Licensed under the Apache License, Version 2.0
  (<https://www.apache.org/licenses/LICENSE-2.0>)
- Obtained via the fork [britkat1980/givenergy-modbus](https://github.com/britkat1980/givenergy-modbus)
  at commit `a556333`

Upstream redacted serial numbers at the byte level during capture: each serial keeps
its family prefix, manufacture date and middle letter, and its last three digits read
`000` (for example `XX2231X000`, or `XX0000X000` where no date was known).

Every file is unchanged apart from its file name. None was trimmed; together they are
about 660 KB.

| File | Upstream path (under `tests/fixtures/captures/`) |
|---|---|
| `hybrid_gen1_arm449.log` | `hybrid_2_bat_a/hybrid_gen1_arm449_0x11_poll_10min.log` |
| `hybrid_gen2_arm920.log` | `hybrid_gen2_1_bat_a/hybrid_gen2_arm920_60s.log` |
| `ac_arm282.log` | `ems_2_inv_3_bat_a/ac_arm282_2x_givbat52_30min.log` |
| `all_in_one_arm620.log` | `aio_a/aio_arm620_redetect_7min.log` |
| `hybrid_3ph.log` | `three_phase_hv_a/giv3hy11_da011_detect_10min.log` |
| `hybrid_hv_gen3_arm295.log` | `hybrid_hv_gen3_a/givhy80g3hv_hass295_120s.log` |
| `ems_arm1036.log` | `ems_2_inv_3_bat_a/ems_arm1036_60s.log` |
| `gateway_gaaa0014.log` | `gateway_2aio_a/gateway_gaaa0014_10min_night.log` |

## Notes on individual captures

- `hybrid_hv_gen3_arm295.log` holds no HR 0-179 block, so it has no device type code
  (HR 0) or ARM firmware version (HR 21). Upstream took the device type code `0x8102`
  from the reporter's plant export, not from these bytes. Tests that need a model inject
  HR 0 = `0x8102` and HR 21 = 295.
- `hybrid_3ph.log` reports HR 21 = 0. Three-phase units keep their firmware versions in
  IR 1317-1327 instead.
- `gateway_gaaa0014.log` has one line where a heartbeat is glued onto the end of an
  IR 1780 reply. The loader in `test/helpers/capture.ts` splits it using each frame's
  length header.
- `hybrid_hv_gen3_arm295.log` uses the Home Assistant integration's `rx: <hex>` line
  format with a `#` header; the others use `<timestamp> rx <hex>`.
