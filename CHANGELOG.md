# Changelog

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
