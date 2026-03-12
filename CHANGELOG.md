# Changelog

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
