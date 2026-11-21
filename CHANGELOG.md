# Changelog

## [3.0.0](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v2.0.2...givenergy-modbus-v3.0.0) (2026-11-21)


### ⚠ BREAKING CHANGES

* deep imports into dist/ (for example givenergy-modbus/dist/pdu/encode.js) are no longer supported; import from givenergy-modbus.
* LowVoltageBatteryModule.current is removed.
* the 2.x generation model ('gen2' | 'gen3' | 'three_phase'), DeviceType and detectModel, the flat 2.x snapshot types, detectBatteries and the register lookup tables are removed. Use model, layout and capabilities on the v3 snapshot.
* these 2.x exports are removed: Gen2Inverter, Gen3Inverter, detectGeneration, modelToGeneration, InverterGeneration, Gen2Snapshot, Gen3Snapshot, BatteryPauseMode, BatterySnapshot, MeterSnapshot and TimeSlot. ThreePhaseInverter, InverterSnapshot, ThreePhaseSnapshot, TimeSlotConfig, TimeSlotInput, InverterIdentity and DiscoveredDevice keep their names but are the v3 types (ThreePhase is now readonly [T, T, T]).
* setEcoMode, setTimedExport, setTimedCharge, setChargeTarget, setChargeRate(Percent), setDischargeRate(Percent), setBatteryReserve, setBatteryPowerReserve, setExportLimit, setBatteryPauseMode, setTimedDischarge and setTimedDischargeSlot are removed. Use setSetting / setBatteryPause / setChargeSlot.
* InverterSnapshot is regrouped (identity, status, solar, battery, grid, inverter, eps, load, settings, schedules), discriminated on `layout` instead of `generation`. See website/migration-v3.md.
* drop EOL Node 20, add Node 26 ([#40](https://github.com/jak/givenergy-modbus/issues/40))

### ci

* drop EOL Node 20, add Node 26 ([#40](https://github.com/jak/givenergy-modbus/issues/40)) ([41fe60d](https://github.com/jak/givenergy-modbus/commit/41fe60da3eed54158fada57186b59039bd5fc89f))


### Features

* assemble the v3 snapshot ([43e3d8e](https://github.com/jak/givenergy-modbus/commit/43e3d8e88e3d2b50e233ea0961bbc7482384470b))
* build settings and schedules from the catalogue and capabilities ([86cb9e0](https://github.com/jak/givenergy-modbus/commit/86cb9e0ffd84cbf6063f351c1de2386931a11945))
* capability-aware schedule and battery pause writes ([67cb213](https://github.com/jak/givenergy-modbus/commit/67cb21378fdef7555fc611df40bc32ade54f43d2))
* compute capabilities from model and firmware ([8dce319](https://github.com/jak/givenergy-modbus/commit/8dce319eba873e80011405b93761530d1299ddcb))
* decode identity, status and fault registers ([282fe08](https://github.com/jak/givenergy-modbus/commit/282fe081ebdb6aa35df88d491804a10c6d008b98))
* decode power groups for both layouts ([9e84564](https://github.com/jak/givenergy-modbus/commit/9e8456497abc14fce7e45291b7d904ffd5462400))
* derive polled blocks from capabilities and stop requesting unanswered blocks ([0b07480](https://github.com/jak/givenergy-modbus/commit/0b0748073b0fb9984d927c6c480a9d7595ca73ba))
* resolve inverter model from device type code and firmware ([1132e26](https://github.com/jak/givenergy-modbus/commit/1132e26af68e68c41974b0559806c40dc6fb6f4b))
* restrict the package entry points with an exports map ([3a9e7c8](https://github.com/jak/givenergy-modbus/commit/3a9e7c81a6f58845494ce36a99d0474f9d4227d7))
* setSetting and unsafe_setSetting replace per-setting methods ([ff35d76](https://github.com/jak/givenergy-modbus/commit/ff35d768fc51c7b02fd7030be4718a12d93bb35e))
* settings catalogue for every single-register setting ([d32f444](https://github.com/jak/givenergy-modbus/commit/d32f444aae2d40d5bb4389f9da034cc830bb10c6))
* settings catalogue types and value codec ([a0beed1](https://github.com/jak/givenergy-modbus/commit/a0beed17c63072c759f8fa4c5e9cd4111375671d))
* typed inverter events and warning-free API docs ([bc58097](https://github.com/jak/givenergy-modbus/commit/bc580977bbd36768df594e97732666a982aa04a8))
* v3 public exports ([fb4bda8](https://github.com/jak/givenergy-modbus/commit/fb4bda8334311b6149760cf47b7ea72a230eef2c))
* v3 snapshot types grouped by subsystem ([72288bc](https://github.com/jak/givenergy-modbus/commit/72288bc26b32b79e43952703be8bdb0110c1da6b))


### Bug Fixes

* decode HR 22 = 2 as a Wi-Fi dongle ([329bd06](https://github.com/jak/givenergy-modbus/commit/329bd06fb57f9ce6235f8ba4461953d42ec65056))
* drop HR 4109-4112 from battery totals (write-only seed registers) ([a650451](https://github.com/jak/givenergy-modbus/commit/a6504514231351634817208c357a16321258362f))
* drop the inverter power factor and zero unused meter phases ([efa21a0](https://github.com/jak/givenergy-modbus/commit/efa21a0fb7b6832440fb52961124b8fd6a470aa1))
* drop three-phase per-phase load, which contradicts the load total ([41da546](https://github.com/jak/givenergy-modbus/commit/41da5463179cd7f5b27068d8ef28c07e96564333))
* emit one data event per write call ([bb6d20e](https://github.com/jak/givenergy-modbus/commit/bb6d20ebde92f6da4b55db39d35749958b8d07d3))
* inverter review fixes from Phase D ([784ba6a](https://github.com/jak/givenergy-modbus/commit/784ba6a504e889a8896a6a606310a991ffa6c835))
* keep pushed meter data and skip product reads for absent meters ([676f5a4](https://github.com/jak/givenergy-modbus/commit/676f5a412c5779d220d23e74bcd4ceb088d5721b))
* keep re-resolving the model until a snapshot passes the sanity check ([4c073a9](https://github.com/jak/givenergy-modbus/commit/4c073a99e7771f81e5604fd9f0436afea50f864d))
* leave battery totals absent instead of falling back to the AC charge total ([f6c0eef](https://github.com/jak/givenergy-modbus/commit/f6c0eefd5619aea4891a68a9790a7aabae1dcbeb))
* leave derived consumption out on AC-coupled models ([538e1ba](https://github.com/jak/givenergy-modbus/commit/538e1baf33cd93eba33a17845f012defc9631551))
* leave unread registers out instead of zero-filling them ([b8828a5](https://github.com/jak/givenergy-modbus/commit/b8828a516d32f099bce9582896de27fd77a5c433))
* number each time slot from its registers ([17030ef](https://github.com/jak/givenergy-modbus/commit/17030efc780292fdcfa25b80ba1591b5f6aa80fc))
* pipeline the battery and meter scans ([098d149](https://github.com/jak/givenergy-modbus/commit/098d149b0757f9cfe481b94dd2b164b59be5cd38))
* read battery and inverter temperatures as signed ([3778fef](https://github.com/jak/givenergy-modbus/commit/3778fef6bd523e448537653c4cb135f76748ad2b))
* read IR 1083-1085 as per-phase grid power ([dbc55d3](https://github.com/jak/givenergy-modbus/commit/dbc55d3c573b9ab6eec244008cf3c36b19dfedda))
* report a lost inverter after 3 failed polls, or at once when the socket closes ([5265949](https://github.com/jak/givenergy-modbus/commit/52659495c23d21a56c9c5355e27107ad832824e1))
* skip pushed blocks, accept late replies and stop rescanning silent meters ([5b86296](https://github.com/jak/givenergy-modbus/commit/5b86296c3f228f2cf76ada57935c51d93a0db948))
* stop cleanly, keep answered blocks and isolate listener errors ([b4256aa](https://github.com/jak/givenergy-modbus/commit/b4256aaf6508f9c044dc83f0de504688a0359131))
* stop exposing the low-voltage battery module current (IR 95) ([3eca384](https://github.com/jak/givenergy-modbus/commit/3eca3840cc0d43a1ca891fedf02b33f256446afa))
* take battery stack and module indexes from the device address ([2c86be4](https://github.com/jak/givenergy-modbus/commit/2c86be4d7a17ffacb013a6134307cf74ba4a80bd))
* update the snapshot clock on setDateTime with one data event ([e784e3c](https://github.com/jak/givenergy-modbus/commit/e784e3c5e7c57bb7d77b0464c797398b22897976))


### Refactoring

* remove 2.x generation model and flat snapshot ([abb0c15](https://github.com/jak/givenergy-modbus/commit/abb0c1529fd6862ab59c1cbe95b6f3151834f927))

## [2.0.2](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v2.0.1...givenergy-modbus-v2.0.2) (2026-07-06)


### Bug Fixes

* detect dead transport so a rebooted inverter reconnects instead of freezing ([#38](https://github.com/jak/givenergy-modbus/issues/38)) ([cc89e9c](https://github.com/jak/givenergy-modbus/commit/cc89e9cef5ef1679a16691e9ee8b6e57c6b33720))

## [2.0.1](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v2.0.0...givenergy-modbus-v2.0.1) (2026-04-12)


### Bug Fixes

* add connect timeout to prevent indefinite hang on silent packet drops ([#36](https://github.com/jak/givenergy-modbus/issues/36)) ([fe883a5](https://github.com/jak/givenergy-modbus/commit/fe883a50ba911124f98013ac4f3847d4fff00d68))

## [2.0.0](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v1.2.0...givenergy-modbus-v2.0.0) (2026-03-15)


### Bug Fixes

* replace mutually exclusive mode with independent toggles ([#32](https://github.com/jak/givenergy-modbus/issues/32)) ([dd6eba1](https://github.com/jak/givenergy-modbus/commit/dd6eba14e273c0d057d91fba0c77b771612100e0))


### Miscellaneous

* release 2.0.0 ([556621c](https://github.com/jak/givenergy-modbus/commit/556621c5b4eef5be65c2f7935548d5cfed1390ba))

## [1.2.0](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v1.1.2...givenergy-modbus-v1.2.0) (2026-03-12)


### Features

* add lightweight inverter identity probe ([#29](https://github.com/jak/givenergy-modbus/issues/29)) ([c337ef8](https://github.com/jak/givenergy-modbus/commit/c337ef8e641c2cab6ed52efb4045e211c49f00d5))
* add mode, battery reserve, charge/discharge rates, and pause mode to snapshot ([4dece9f](https://github.com/jak/givenergy-modbus/commit/4dece9fd1d7869879a2f9ace8e7b86474ed982f7))


### Bug Fixes

* replace onProbe with onScanProgress + onFound callbacks ([#30](https://github.com/jak/givenergy-modbus/issues/30)) ([6140a77](https://github.com/jak/givenergy-modbus/commit/6140a77600e801f95b1f66e4b553d72bcf67344e))

## [1.1.2](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v1.1.1...givenergy-modbus-v1.1.2) (2026-03-10)


### Bug Fixes

* reject connect() when inverter returns empty serial number ([#24](https://github.com/jak/givenergy-modbus/issues/24)) ([81f1ad4](https://github.com/jak/givenergy-modbus/commit/81f1ad4f9a7f61470f2fe32c732e80c4d1152a76))
* verify discovered devices with active modbus probe ([#25](https://github.com/jak/givenergy-modbus/issues/25)) ([e1edd49](https://github.com/jak/givenergy-modbus/commit/e1edd49ea2a02bc61e7a6fd31dae50fb418f8fd3))

## [1.1.1](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v1.1.0...givenergy-modbus-v1.1.1) (2026-03-07)


### Bug Fixes

* prefer 32-bit battery energy total registers ([#8](https://github.com/jak/givenergy-modbus/issues/8)) ([#19](https://github.com/jak/givenergy-modbus/issues/19)) ([e1260ca](https://github.com/jak/givenergy-modbus/commit/e1260ca079f7ec22432901bf1cf72a97dc26a3a1))
* validate system time components before Date construction ([#9](https://github.com/jak/givenergy-modbus/issues/9)) ([#22](https://github.com/jak/givenergy-modbus/issues/22)) ([4c650c3](https://github.com/jak/givenergy-modbus/commit/4c650c38c5ec54ed1a1d9763187e99aba83dbb29))

## [1.1.0](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v1.0.0...givenergy-modbus-v1.1.0) (2026-03-07)


### Features

* implement HV battery scanning ([#14](https://github.com/jak/givenergy-modbus/issues/14)) ([9022c09](https://github.com/jak/givenergy-modbus/commit/9022c09049ad6fe06a23ac538ff2ce74c1228ce5))


### Bug Fixes

* apply toDeci before frequency &gt;100 check ([#7](https://github.com/jak/givenergy-modbus/issues/7)) ([#17](https://github.com/jak/givenergy-modbus/issues/17)) ([1e21efc](https://github.com/jak/givenergy-modbus/commit/1e21efc1769f712ee2a5ec42a9be5277da09adce))
* change license from MIT to GPL-3.0 ([#18](https://github.com/jak/givenergy-modbus/issues/18)) ([658a85b](https://github.com/jak/givenergy-modbus/commit/658a85b09d1de83390434776f274940d423b900c)), closes [#16](https://github.com/jak/givenergy-modbus/issues/16)
* continue battery scan past non-contiguous slots ([#6](https://github.com/jak/givenergy-modbus/issues/6)) ([#15](https://github.com/jak/givenergy-modbus/issues/15)) ([bedad35](https://github.com/jak/givenergy-modbus/commit/bedad35749bed3eacc3a697f7ec9cf3de7460728))
* filter ghost batteries with whitespace-only serial numbers ([#11](https://github.com/jak/givenergy-modbus/issues/11)) ([b03f050](https://github.com/jak/givenergy-modbus/commit/b03f050e631523eaa0038bfbd88085146ff1f13b)), closes [#3](https://github.com/jak/givenergy-modbus/issues/3)
* normalise time slot value 2400 to 00:00 ([#12](https://github.com/jak/givenergy-modbus/issues/12)) ([f9696fe](https://github.com/jak/givenergy-modbus/commit/f9696fea18bfd4a3ae107910b7697b9aeb1f0b16))

## [1.0.0](https://github.com/jak/givenergy-modbus/compare/givenergy-modbus-v0.1.0...givenergy-modbus-v1.0.0) (2026-03-07)


### ⚠ BREAKING CHANGES

* add automatic reconnection with exponential backoff ([#10](https://github.com/jak/givenergy-modbus/issues/10))

### Features

* add automatic reconnection with exponential backoff ([#10](https://github.com/jak/givenergy-modbus/issues/10)) ([b0103d9](https://github.com/jak/givenergy-modbus/commit/b0103d9bf15d14aed10f89b52c9129dac7a0aaf0))
* add CT meter support and fix battery power sign convention ([fcde579](https://github.com/jak/givenergy-modbus/commit/fcde579c12da33bfc3ea91aa61058d0a93e392a8))
* add daily energy totals and consumption to snapshot ([63f88f6](https://github.com/jak/givenergy-modbus/commit/63f88f693e5e14f88680aa45774318eae5d9f77b))
* add data validation and fallback logic porting GivTCP workarounds ([f008e91](https://github.com/jak/givenergy-modbus/commit/f008e917f1bf4ea4b74c986ac70d010cd2dc8287))
* add GivEnergyInverter public API with EventEmitter ([2fb540b](https://github.com/jak/givenergy-modbus/commit/2fb540bf6ccdc3667178fb2a66a06799b6de91d7))
* add inverter generation detection from serial prefix ([b4c3c3d](https://github.com/jak/givenergy-modbus/commit/b4c3c3d55c5dc16b29fa2714a7e2affa8ff67836))
* add model detection and battery plant configuration ([c598577](https://github.com/jak/givenergy-modbus/commit/c59857797ed61cce1466bc5eee576524bb5b9710))
* add PayloadEncoder/PayloadDecoder with Modbus CRC-16 ([66ccad9](https://github.com/jak/givenergy-modbus/commit/66ccad99cc9e089e6fbd07a5a633c9fe5f5a105e))
* add PDU encoding/decoding with GivEnergy protocol quirks ([e69866d](https://github.com/jak/givenergy-modbus/commit/e69866d43fa69e9460f0b71b633a9c56737aabbc))
* add per-string PV daily energy and clarify inverter vs BMS fields ([63e641d](https://github.com/jak/givenergy-modbus/commit/63e641dca52381b499b8f1757d673e0499adf041))
* add PollManager with 15s/60s refresh cycle and failure tracking ([c6f9672](https://github.com/jak/givenergy-modbus/commit/c6f9672760606df71eef53672251042089b8672e))
* add power flow calculator ported from GivTCP read.py ([4d9df12](https://github.com/jak/givenergy-modbus/commit/4d9df121fd84ee73f1035d8f0ca4f70688c4d2ea))
* add register lookup tables for inverter, battery, meter registers ([308ba49](https://github.com/jak/givenergy-modbus/commit/308ba495baa6d2c08eba4800ee69f985dd7ce00c))
* add register types and converter functions ([485a8fe](https://github.com/jak/givenergy-modbus/commit/485a8fe2e0cf88133aa37230c9eb76b478ace348))
* add shape-hash response matching for non-sequential GivEnergy transaction IDs ([5445116](https://github.com/jak/givenergy-modbus/commit/544511640a693d321361018c51753baa7b5dd540))
* add sliding-window frame parser for GivEnergy protocol ([66c400f](https://github.com/jak/givenergy-modbus/commit/66c400fe3e95575a06d9dda42ef5444421b24800))
* add snapshot builder with GivEnergy data assembly quirks ([23b1143](https://github.com/jak/givenergy-modbus/commit/23b1143a9fc60d19273fb2764007eb142db52413))
* add subnet discovery scanner ported from GivTCP findInvertor.py ([9ad3ab6](https://github.com/jak/givenergy-modbus/commit/9ad3ab65ec9817ab669412d320d9a22cfe49a9eb))
* add TCP client with 250ms throttle, heartbeat, and retry logic ([92330f7](https://github.com/jak/givenergy-modbus/commit/92330f7e4545b895b41f677e3e3c2b62f55a680d))
* expand timeslot API to 10 slots, add unsafe_writeRegister, remove waitForHeartbeat ([30482ac](https://github.com/jak/givenergy-modbus/commit/30482ac71ed4b424dbb27350c0a59e03a8f7fca1))
* expose additional inverter registers and fix single-phase meter totals ([b69e945](https://github.com/jak/givenergy-modbus/commit/b69e945d96bd80902f7617bd387f22a7a110bc58))
* generation-aware register ranges in poll manager ([d91d90b](https://github.com/jak/givenergy-modbus/commit/d91d90be1b4e955066e95a6bfb302fa15fc0c22d))
* generation-aware snapshots with discriminated union types ([343a471](https://github.com/jak/givenergy-modbus/commit/343a471fe7d4653e06c1cbc3978fdb557251d740))
* scaffold givenergy-modbus TypeScript package ([8b63b71](https://github.com/jak/givenergy-modbus/commit/8b63b71808c90cfb0979144e3d81a0bb45042e6d))


### Bug Fixes

* add meter slave handling to test mock inverters ([3a03822](https://github.com/jak/givenergy-modbus/commit/3a03822a7c56bd4216e582bd21230b36b28f5512))
* detect inverter generation from registers instead of serial prefix ([177b1e2](https://github.com/jak/givenergy-modbus/commit/177b1e262b73b568cbf2ea672a9708f27bb32b11))
* resolve code review issues in inverter subclasses ([24bb58c](https://github.com/jak/givenergy-modbus/commit/24bb58cf4839a3788b5af63b095758d111a7f155))
