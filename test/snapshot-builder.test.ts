import { describe, it, expect } from 'vitest';
import { buildSnapshot, buildBatterySnapshot, buildBmuSnapshot, parseBcuData, buildMeterSnapshot, type RegisterCache } from '../src/snapshot-builder.js';

/**
 * Build a minimal but valid register cache for testing.
 *
 * Register addresses are taken from INVERTER_INPUT_REGISTERS and
 * INVERTER_HOLDING_REGISTERS in register-lut.ts.
 *
 * Key addresses used:
 *   IR(41)  = temp_inverter_heatsink (sanity check)
 *   HR(34)  = modbus_version (sanity check: toCenti < 2)
 *   HR(30)  = modbus_address (sanity check: < 100)
 *   HR(33)  = user_code (sanity check: < 100)
 *   HR(13-17) = serial_number (5 regs, 10 chars)
 *   HR(0)   = device_type_code
 *   IR(59)  = battery_percent (SOC)
 *   IR(13)  = f_ac1 (AC frequency)
 *   IR(52)  = p_battery (signed, positive=discharging)
 *   IR(30)  = p_grid_out (signed, positive=export)
 *   IR(42)  = p_load_demand
 *   IR(18)  = p_pv1, IR(20) = p_pv2
 *   HR(94)  = charge_slot_1_start, HR(95) = charge_slot_1_end
 *   HR(56)  = discharge_slot_1_start, HR(57) = discharge_slot_1_end
 *   HR(96)  = enable_charge, HR(59) = enable_discharge
 *   HR(116) = charge_target_soc
 *   HR(35-40) = system_time (year, month, day, hour, minute, second)
 *   IR(11,12) = e_pv_total (uint32)
 *   IR(27,28) = e_inverter_in_total (uint32) — battery charge total
 *   IR(29)  = e_discharge_year
 *   IR(21,22) = e_grid_out_total (uint32)
 *   IR(32,33) = e_grid_in_total (uint32)
 *   IR(50)  = v_battery, IR(51) = i_battery
 *   IR(5)   = v_ac1 (grid voltage)
 */
function makeValidCache(): RegisterCache {
  const ir = new Map<number, number>();
  const hr = new Map<number, number>();

  // Sanity check registers
  ir.set(41, 350);  // temp_inverter_heatsink: 350 raw → toDeci = 35°C (valid, < 100°C)
  hr.set(34, 40);   // modbus_version: 40 raw → toCenti = 0.40 (valid, < 2)
  hr.set(30, 1);    // modbus_address: 1 (valid, < 100)
  hr.set(33, 1);    // user_code: 1 (valid, < 100)

  // Serial number: HR(13-17) = 'EE1234B567' (EE prefix → gen3)
  const serial = 'EE1234B567';
  for (let i = 0; i < 5; i++) {
    hr.set(13 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }

  // Device type code: HR(0) and arm_firmware_version: HR(21)
  // 0x2001 = hybrid, arm_fw 300 → gen3 (Math.floor(300/100) === 3)
  hr.set(0, 0x2001);
  hr.set(21, 300);

  // SOC: IR(59) = 75%
  ir.set(59, 75);

  // AC frequency: IR(13) = 5000 → applyFrequencyScaling(>100) → /10 = 500 → toDeci = 50Hz
  ir.set(13, 5000);

  // Power registers (all signed int16, watts)
  ir.set(52, 0);    // p_battery: 0W (no charge/discharge)
  ir.set(30, 0);    // p_grid_out: 0W
  ir.set(42, 500);  // p_load_demand: 500W
  ir.set(18, 500);  // p_pv1: 500W
  ir.set(20, 0);    // p_pv2: 0W

  // Voltage/current
  ir.set(50, 4800); // v_battery: 4800 raw → toCenti = 48.0V
  ir.set(51, 0);    // i_battery: 0A
  ir.set(5, 2320);  // v_ac1: 2320 raw → toDeci = 232V

  // Charge/discharge slots
  hr.set(94, 0);    // charge_slot_1_start: 0 = "00:00"
  hr.set(95, 430);  // charge_slot_1_end: 430 = "04:30"
  hr.set(56, 0);    // discharge_slot_1_start: 0 = "00:00"
  hr.set(57, 0);    // discharge_slot_1_end: 0 = "00:00"

  // Enable flags
  hr.set(96, 1);    // enable_charge: true
  hr.set(59, 0);    // enable_discharge: false
  hr.set(116, 100); // charge_target_soc: 100%

  // System time: HR(35-40) = 2024-06-15 14:30:00
  // GivEnergy stores year as 2-digit offset from 2000 (e.g. 24 = 2024)
  hr.set(35, 24); // year: 2000 + 24 = 2024
  hr.set(36, 6);    // month
  hr.set(37, 15);   // day
  hr.set(38, 14);   // hour
  hr.set(39, 30);   // minute
  hr.set(40, 0);    // second

  // Energy totals as uint32 (high word, low word)
  ir.set(11, 0);    // e_pv_total high
  ir.set(12, 1000); // e_pv_total low → 1000 * 0.1 = 100kWh (toDeci applied)
  ir.set(27, 0);    // e_inverter_in_total high (battery charge)
  ir.set(28, 500);  // e_inverter_in_total low
  ir.set(29, 0);    // e_discharge_year (used as discharge total fallback)
  ir.set(21, 0);    // e_grid_out_total high
  ir.set(22, 200);  // e_grid_out_total low
  ir.set(32, 0);    // e_grid_in_total high
  ir.set(33, 800);  // e_grid_in_total low

  // Battery discharge total registers
  ir.set(6, 0);     // e_battery_throughput_total high
  ir.set(7, 0);     // e_battery_throughput_total low

  return { inputRegisters: ir, holdingRegisters: hr };
}

/** Gen2 cache: hybrid with arm_fw 800 → gen2 (Math.floor(800/100) === 8) */
function makeGen2Cache(): RegisterCache {
  const cache = makeValidCache();
  const serial = 'CE1234B567';
  for (let i = 0; i < 5; i++) {
    cache.holdingRegisters.set(13 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }
  cache.holdingRegisters.set(0, 0x2001);
  cache.holdingRegisters.set(21, 800);
  return cache;
}

/** Three-phase cache: device_type_code 0x4001 → three_phase */
function makeThreePhaseCache(): RegisterCache {
  const cache = makeValidCache();
  const serial = 'SA1234B567';
  for (let i = 0; i < 5; i++) {
    cache.holdingRegisters.set(13 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }
  cache.holdingRegisters.set(0, 0x4001);
  return cache;
}

describe('SnapshotBuilder', () => {
  describe('buildSnapshot', () => {
    it('returns null when heatsink temperature exceeds 100°C sanity threshold', () => {
      // Sanity check: heatsink temp > 100°C indicates corrupt register data,
      // not an actual overheating event. GivTCP discards such reads.
      const cache = makeValidCache();
      cache.inputRegisters.set(41, 1100); // 1100 raw → toDeci = 110°C → fails sanity check
      expect(buildSnapshot(cache)).toBeNull();
    });

    it('returns a snapshot with the serial number from holding registers', () => {
      const snapshot = buildSnapshot(makeValidCache());
      expect(snapshot).not.toBeNull();
      expect(snapshot!.serialNumber).toBe('EE1234B567');
    });

    it('returns a snapshot with all required fields', () => {
      const snapshot = buildSnapshot(makeValidCache());
      expect(snapshot).not.toBeNull();
      expect(typeof snapshot!.solarPower).toBe('number');
      expect(typeof snapshot!.batteryPower).toBe('number');
      expect(typeof snapshot!.gridPower).toBe('number');
      expect(typeof snapshot!.loadPower).toBe('number');
      expect(typeof snapshot!.stateOfCharge).toBe('number');
      expect(typeof snapshot!.gridFrequency).toBe('number');
      expect(typeof snapshot!.inverterHeatsinkTemp).toBe('number');
      expect(snapshot!.systemTime).toBeInstanceOf(Date);
      expect(snapshot!.chargeSlots).toBeInstanceOf(Array);
      expect(snapshot!.chargeSlots[0]).toHaveProperty('start');
      expect(snapshot!.chargeSlots[0]).toHaveProperty('end');
      expect(snapshot!.batteries).toBeInstanceOf(Array);
      expect(snapshot!.powerFlows).toBeDefined();
    });

    it('applies SOC fallback: 0% reported with previous → use previous', () => {
      // Communication glitches can cause 0% SOC readings.
      // The library substitutes the last known good value.
      const cache = makeValidCache();
      cache.inputRegisters.set(59, 0); // report 0% SOC
      const prevSnapshot = { stateOfCharge: 72 } as any;
      const snapshot = buildSnapshot(cache, { previousSnapshot: prevSnapshot });
      expect(snapshot!.stateOfCharge).toBe(72);
    });

    it('does not apply SOC fallback when SOC > 0', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(59, 65);
      const prevSnapshot = { stateOfCharge: 72 } as any;
      const snapshot = buildSnapshot(cache, { previousSnapshot: prevSnapshot });
      expect(snapshot!.stateOfCharge).toBe(65);
    });

    it('applies frequency scaling: raw > 100 divided by 10', () => {
      // Old firmware: frequency register > 100 means raw value needs /10 before toDeci.
      // 5000 → applyFrequencyScaling → 500 → toDeci → 50.0 Hz
      const cache = makeValidCache();
      cache.inputRegisters.set(13, 5000); // f_ac1: old firmware centi-Hz
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.gridFrequency).toBeCloseTo(50, 0);
    });

    it('does not scale frequency when raw <= 100', () => {
      // Newer firmware: already in deci-Hz units.
      // 500 → applyFrequencyScaling (no change, <= 100 is raw value) → toDeci → 50Hz
      // Actually 50 raw → applyFrequencyScaling → 50 (no change) → toDeci → 5Hz
      // The test here checks that the scaling branch is NOT entered for raw=500 (which IS > 100)
      // So let's use a value <= 100: 50 → no scale → toDeci = 5.0Hz
      const cache = makeValidCache();
      cache.inputRegisters.set(13, 50); // f_ac1: 50 raw, no scaling → toDeci = 5.0Hz
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.gridFrequency).toBeCloseTo(5.0, 1);
    });

    it('reads device type code as model code', () => {
      const snapshot = buildSnapshot(makeValidCache());
      expect(snapshot!.modelCode).toBe(0x2001);
    });

    it('reads charge slot 1 correctly', () => {
      const snapshot = buildSnapshot(makeValidCache());
      expect(snapshot!.chargeSlots[0].start).toBe('00:00');
      expect(snapshot!.chargeSlots[0].end).toBe('04:30');
    });

    it('reads discharge slot 1 correctly', () => {
      const snapshot = buildSnapshot(makeValidCache());
      expect(snapshot!.dischargeSlots[0].start).toBe('00:00');
      expect(snapshot!.dischargeSlots[0].end).toBe('00:00');
    });

    it('sets generation field from device_type_code and arm_firmware_version', () => {
      // hybrid + arm_fw 300 → gen3
      const gen3Snapshot = buildSnapshot(makeValidCache());
      expect(gen3Snapshot!.generation).toBe('gen3');

      // device_type_code 0x4001 → three_phase
      const threePhaseCache = makeThreePhaseCache();
      const threePhaseSnapshot = buildSnapshot(threePhaseCache);
      expect(threePhaseSnapshot!.generation).toBe('three_phase');

      // hybrid + arm_fw 800 → gen2
      const gen2Cache = makeGen2Cache();
      const gen2Snapshot = buildSnapshot(gen2Cache);
      expect(gen2Snapshot!.generation).toBe('gen2');
    });

    it('detects gen3 from registers even with unknown serial prefix', () => {
      // FD prefix is not in the serial prefix map, but HR(0)/HR(21) correctly identify gen3.
      // This was a real bug: FD2308F729 was misdetected as gen2.
      const cache = makeValidCache();
      const serial = 'FD2308F729';
      for (let i = 0; i < 5; i++) {
        cache.holdingRegisters.set(13 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
      }
      cache.holdingRegisters.set(0, 0x2001);
      cache.holdingRegisters.set(21, 300);
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.serialNumber).toBe('FD2308F729');
      expect(snapshot!.generation).toBe('gen3');
    });

    it('reads all 10 charge and discharge slots for Gen3', () => {
      // Gen3 inverters have 10 timeslots. Unset slots read as 00:00-00:00 / SOC 0.
      const snapshot = buildSnapshot(makeValidCache());
      expect(snapshot!.chargeSlots).toHaveLength(10);
      expect(snapshot!.dischargeSlots).toHaveLength(10);
      // Slot 1 was set in the cache
      expect(snapshot!.chargeSlots[0].end).toBe('04:30');
      // Slots 2-10 default to 00:00
      for (let i = 1; i < 10; i++) {
        expect(snapshot!.chargeSlots[i].start).toBe('00:00');
        expect(snapshot!.chargeSlots[i].end).toBe('00:00');
        // targetStateOfCharge is present on gen3 slots
        const slot = snapshot!.chargeSlots[i] as { targetStateOfCharge: number };
        expect(slot.targetStateOfCharge).toBe(0);
      }
    });

    it('reads per-slot target state of charge for Gen3 timeslots', () => {
      const cache = makeValidCache();
      // Set Gen3 charge slot 2: HR(243)=start, HR(244)=end, HR(245)=target SOC
      cache.holdingRegisters.set(243, 100);  // 01:00
      cache.holdingRegisters.set(244, 430);  // 04:30
      cache.holdingRegisters.set(245, 80);   // 80% target SOC
      const snapshot = buildSnapshot(cache);
      const slot2 = snapshot!.chargeSlots[1] as { start: string; end: string; targetStateOfCharge: number };
      expect(slot2.start).toBe('01:00');
      expect(slot2.end).toBe('04:30');
      expect(slot2.targetStateOfCharge).toBe(80);
    });

    it('Gen2: returns 1 charge slot and 2 discharge slots without targetStateOfCharge', () => {
      const cache = makeGen2Cache();
      cache.holdingRegisters.set(94, 0);    // charge slot 1 start: 00:00
      cache.holdingRegisters.set(95, 430);  // charge slot 1 end: 04:30
      cache.holdingRegisters.set(56, 100);  // discharge slot 1 start: 01:00
      cache.holdingRegisters.set(57, 200);  // discharge slot 1 end: 02:00
      cache.holdingRegisters.set(44, 300);  // discharge slot 2 start: 03:00
      cache.holdingRegisters.set(45, 400);  // discharge slot 2 end: 04:00
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.generation).toBe('gen2');
      expect(snapshot!.chargeSlots).toHaveLength(1);
      expect(snapshot!.dischargeSlots).toHaveLength(2);
      expect(snapshot!.chargeSlots[0].start).toBe('00:00');
      expect(snapshot!.chargeSlots[0].end).toBe('04:30');
      expect('targetStateOfCharge' in snapshot!.chargeSlots[0]).toBe(false);
    });

    it('three_phase: returns 2 charge slots and 2 discharge slots from three-phase registers', () => {
      const cache = makeThreePhaseCache();
      cache.holdingRegisters.set(1113, 0);    // charge slot 1 start: 00:00
      cache.holdingRegisters.set(1114, 430);  // charge slot 1 end: 04:30
      cache.holdingRegisters.set(1115, 100);  // charge slot 2 start: 01:00
      cache.holdingRegisters.set(1116, 200);  // charge slot 2 end: 02:00
      cache.holdingRegisters.set(1118, 0);    // discharge slot 1 start
      cache.holdingRegisters.set(1119, 0);    // discharge slot 1 end
      cache.holdingRegisters.set(1120, 0);    // discharge slot 2 start
      cache.holdingRegisters.set(1121, 0);    // discharge slot 2 end
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.generation).toBe('three_phase');
      expect(snapshot!.chargeSlots).toHaveLength(2);
      expect(snapshot!.dischargeSlots).toHaveLength(2);
      expect(snapshot!.chargeSlots[0].end).toBe('04:30');
      expect(snapshot!.chargeSlots[1].start).toBe('01:00');
      expect('targetStateOfCharge' in snapshot!.chargeSlots[0]).toBe(false);
    });

    it('reads enable_charge flag correctly', () => {
      const cache = makeValidCache();
      cache.holdingRegisters.set(96, 1);
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.enableCharge).toBe(true);
    });

    it('reads enable_discharge flag correctly', () => {
      const cache = makeValidCache();
      cache.holdingRegisters.set(59, 0); // HR(59) = enable_discharge
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.enableDischarge).toBe(false);
    });

    it('reads heatsink temp via toDeci', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(41, 350); // 350 raw → toDeci = 35°C
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.inverterHeatsinkTemp).toBeCloseTo(35, 1);
    });

    it('reads system time from HR(35-40)', () => {
      const snapshot = buildSnapshot(makeValidCache());
      const t = snapshot!.systemTime;
      expect(t.getFullYear()).toBe(2024);
      expect(t.getMonth()).toBe(5); // June = month index 5
      expect(t.getDate()).toBe(15);
    });

    it('falls back to previous system time when year is 2000', () => {
      const cache = makeValidCache();
      cache.holdingRegisters.set(35, 0); // year 2000 + 0 = 2000 = RTC not synced
      const prevTime = new Date('2024-01-01T12:00:00');
      const prevSnapshot = { systemTime: prevTime } as any;
      const snapshot = buildSnapshot(cache, { previousSnapshot: prevSnapshot });
      expect(snapshot!.systemTime).toBe(prevTime);
    });

    it('returns batteries as empty array when no battery caches provided', () => {
      const snapshot = buildSnapshot(makeValidCache());
      expect(snapshot!.batteries).toHaveLength(0);
    });

    it('includes battery snapshots when battery register caches are provided', () => {
      const batteryCache = new Map<number, number>();
      const serial = 'CE1234B001';
      for (let i = 0; i < 5; i++) {
        batteryCache.set(110 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
      }
      batteryCache.set(100, 80); // soc
      for (let i = 0; i < 16; i++) {
        batteryCache.set(60 + i, 3250); // cell voltages
      }
      batteryCache.set(103, 250); // t_max
      batteryCache.set(104, 230); // t_min
      batteryCache.set(96, 42);  // num_cycles

      const batteryCaches = new Map([[0x32, batteryCache]]);
      const snapshot = buildSnapshot(makeValidCache(), { batteryRegisterCaches: batteryCaches });
      expect(snapshot!.batteries).toHaveLength(1);
      expect(snapshot!.batteries[0].serialNumber).toBe('CE1234B001');
    });

    it('extracts daily energy values from IR registers via toDeci', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(17, 15);  // e_pv1_day: 15 → toDeci = 1.5 kWh
      cache.inputRegisters.set(19, 13);  // e_pv2_day: 13 → toDeci = 1.3 kWh
      cache.inputRegisters.set(36, 97);  // e_battery_charge_today: 97 → 9.7 kWh
      cache.inputRegisters.set(37, 77);  // e_battery_discharge_today: 77 → 7.7 kWh
      cache.inputRegisters.set(26, 135); // e_grid_in_day: 135 → 13.5 kWh
      cache.inputRegisters.set(25, 1);   // e_grid_out_day: 1 → 0.1 kWh
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.pvEnergyTodayKwh).toBeCloseTo(2.8, 1);
      expect(snapshot!.pvString1EnergyTodayKwh).toBeCloseTo(1.5, 1);
      expect(snapshot!.pvString2EnergyTodayKwh).toBeCloseTo(1.3, 1);
      expect(snapshot!.batteryChargeEnergyTodayKwh).toBeCloseTo(9.7, 1);
      expect(snapshot!.batteryDischargeEnergyTodayKwh).toBeCloseTo(7.7, 1);
      expect(snapshot!.gridImportEnergyTodayKwh).toBeCloseTo(13.5, 1);
      expect(snapshot!.gridExportEnergyTodayKwh).toBeCloseTo(0.1, 1);
    });

    it('exposes per-string PV daily energy and their sum', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(17, 30);  // e_pv1_day: 3.0 kWh
      cache.inputRegisters.set(19, 20);  // e_pv2_day: 2.0 kWh
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.pvString1EnergyTodayKwh).toBeCloseTo(3.0, 1);
      expect(snapshot!.pvString2EnergyTodayKwh).toBeCloseTo(2.0, 1);
      expect(snapshot!.pvEnergyTodayKwh).toBeCloseTo(5.0, 1);
    });

    it('computes consumption total: (inverter_out - ac_charge) - (export - import)', () => {
      const cache = makeValidCache();
      // inverter_out_total: IR(45,46) uint32 → toDeci
      cache.inputRegisters.set(45, 0);
      cache.inputRegisters.set(46, 5000);  // 5000 → 500.0 kWh
      // ac_charge_total (inverter_in): IR(27,28) — reused for battery fallback,
      // but consumption uses them directly regardless
      cache.inputRegisters.set(27, 0);
      cache.inputRegisters.set(28, 1000);  // 1000 → 100.0 kWh
      // grid export: IR(21,22)
      cache.inputRegisters.set(21, 0);
      cache.inputRegisters.set(22, 500);   // 500 → 50.0 kWh
      // grid import: IR(32,33)
      cache.inputRegisters.set(32, 0);
      cache.inputRegisters.set(33, 2000);  // 2000 → 200.0 kWh
      // consumption = (500 - 100) - (50 - 200) = 400 + 150 = 550
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.consumptionEnergyTotalKwh).toBeCloseTo(550.0, 1);
    });

    it('computes consumption today using daily registers', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(44, 300);  // e_inverter_out_day: 30.0 kWh
      cache.inputRegisters.set(35, 50);   // e_inverter_in_day (ac_charge): 5.0 kWh
      cache.inputRegisters.set(25, 10);   // e_grid_out_day: 1.0 kWh
      cache.inputRegisters.set(26, 100);  // e_grid_in_day: 10.0 kWh
      // consumption = (30 - 5) - (1 - 10) = 25 + 9 = 34
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.consumptionEnergyTodayKwh).toBeCloseTo(34.0, 1);
    });

    it('clamps consumption to zero when formula yields negative', () => {
      // Edge case: export > inverter output (e.g., during grid passthrough)
      const cache = makeValidCache();
      cache.inputRegisters.set(44, 10);   // inverter_out_day: 1.0 kWh
      cache.inputRegisters.set(35, 0);    // ac_charge_day: 0
      cache.inputRegisters.set(25, 200);  // grid_out_day: 20.0 kWh (huge export)
      cache.inputRegisters.set(26, 0);    // grid_in_day: 0
      // consumption = (1 - 0) - (20 - 0) = -19 → clamped to 0
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.consumptionEnergyTodayKwh).toBe(0);
    });

    it('computes solar power as p_pv1 + p_pv2', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(18, 1500); // p_pv1: 1500W
      cache.inputRegisters.set(20, 800);  // p_pv2: 800W
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.solarPower).toBe(2300);
    });

    it('exposes individual PV string power, voltage, and current', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(18, 1500); // p_pv1: 1500W
      cache.inputRegisters.set(20, 800);  // p_pv2: 800W
      cache.inputRegisters.set(1, 3205);  // v_pv1: toDeci = 320.5V
      cache.inputRegisters.set(2, 3102);  // v_pv2: toDeci = 310.2V
      cache.inputRegisters.set(8, 47);    // i_pv1: toDeci = 4.7A
      cache.inputRegisters.set(9, 26);    // i_pv2: toDeci = 2.6A
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.pvString1Power).toBe(1500);
      expect(snapshot!.pvString2Power).toBe(800);
      expect(snapshot!.pvString1Voltage).toBeCloseTo(320.5, 1);
      expect(snapshot!.pvString2Voltage).toBeCloseTo(310.2, 1);
      expect(snapshot!.pvString1Current).toBeCloseTo(4.7, 1);
      expect(snapshot!.pvString2Current).toBeCloseTo(2.6, 1);
    });

    it('reads inverter output power, grid apparent power, and EPS backup power', () => {
      const cache = makeValidCache();
      // p_inverter_out: IR(24) = 65036 → toInt16 = -500 (negative = consuming from grid)
      cache.inputRegisters.set(24, 65036);
      // p_grid_apparent: IR(43) = 700VA
      cache.inputRegisters.set(43, 700);
      // p_eps_backup: IR(31) = 0W
      cache.inputRegisters.set(31, 0);
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.inverterOutputPower).toBe(-500);
      expect(snapshot!.gridApparentPower).toBe(700);
      expect(snapshot!.epsBackupPower).toBe(0);
    });

    it('reads inverter current via toDeci', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(10, 22); // i_ac1: toDeci = 2.2A
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.inverterCurrent).toBeCloseTo(2.2, 1);
    });

    it('reads EPS backup voltage and frequency', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(53, 2423); // v_eps_backup: toDeci = 242.3V
      cache.inputRegisters.set(54, 4993); // f_eps_backup: toCenti = 49.93Hz
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.epsBackupVoltage).toBeCloseTo(242.3, 1);
      expect(snapshot!.epsBackupFrequency).toBeCloseTo(49.93, 2);
    });

    it('reads charger and battery temperatures via toDeci', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(55, 285); // temp_charger: toDeci = 28.5°C
      cache.inputRegisters.set(56, 190); // temp_battery: toDeci = 19.0°C
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.chargerTemperature).toBeCloseTo(28.5, 1);
      expect(snapshot!.batteryTemperature).toBeCloseTo(19.0, 1);
    });

    it('reads battery throughput total as uint32 toDeci', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(6, 0);     // e_battery_throughput_total high
      cache.inputRegisters.set(7, 54534); // e_battery_throughput_total low → toDeci = 5453.4 kWh
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.batteryThroughputTotalKwh).toBeCloseTo(5453.4, 1);
    });

    it('reads hours of operation as uint32', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(47, 0);     // work_time_total high
      cache.inputRegisters.set(48, 10167); // work_time_total low
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.hoursOfOperation).toBe(10167);
    });
  });

  describe('buildBatterySnapshot', () => {
    function makeBatteryCache(): Map<number, number> {
      const m = new Map<number, number>();
      // Serial number: IR(110-114) = 'CE1234B001'
      const serial = 'CE1234B001';
      for (let i = 0; i < 5; i++) {
        m.set(110 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
      }
      // SOC: IR(100) = 80%
      m.set(100, 80);
      // Temp max: IR(103) = 250 → toDeci = 25°C
      m.set(103, 250);
      // Temp min: IR(104) = 230 → toDeci = 23°C
      m.set(104, 230);
      // Cycle count: IR(96) = 42
      m.set(96, 42);
      // Cell voltages: IR(60-75) = 3250 → toMilli = 3.25V
      for (let i = 0; i < 16; i++) {
        m.set(60 + i, 3250);
      }
      // v_cells_sum: IR(80) → toMilli → V (sum of all cell voltages)
      m.set(80, 52000); // 52000 → toMilli = 52.0V
      // Energy totals
      m.set(105, 500); // e_battery_discharge_total → toDeci = 50.0 kWh
      m.set(106, 800); // e_battery_charge_total → toDeci = 80.0 kWh
      return m;
    }

    it('decodes battery serial number, SOC, temperatures, and cycle count', () => {
      const bat = buildBatterySnapshot(makeBatteryCache());
      expect(bat).not.toBeNull();
      expect(bat!.serialNumber).toBe('CE1234B001');
      expect(bat!.stateOfCharge).toBe(80);
      expect(bat!.temperatureMax).toBeCloseTo(25, 1);
      expect(bat!.temperatureMin).toBeCloseTo(23, 1);
      expect(bat!.cycleCount).toBe(42);
    });

    it('decodes all 16 cell voltages using toMilli', () => {
      const bat = buildBatterySnapshot(makeBatteryCache());
      expect(bat!.cellVoltages).toHaveLength(16);
      // 3250 raw → toMilli = 3.25V
      expect(bat!.cellVoltages[0]).toBeCloseTo(3.25, 2);
      expect(bat!.cellVoltages[15]).toBeCloseTo(3.25, 2);
    });

    it('returns null for all-null serial (no battery present)', () => {
      // GivTCP: battery.is_valid() checks if serial is not all null bytes.
      // This is how LV battery count is determined — scan 0x32-0x37, stop at first null.
      const cache = new Map<number, number>();
      for (let i = 0; i < 5; i++) {
        cache.set(110 + i, 0x0000);
      }
      expect(buildBatterySnapshot(cache)).toBeNull();
    });

    it('returns null for missing serial registers', () => {
      const cache = new Map<number, number>();
      // No registers set at all
      expect(buildBatterySnapshot(cache)).toBeNull();
    });

    it('LV battery snapshots have no stack field by default', () => {
      const bat = buildBatterySnapshot(makeBatteryCache());
      expect(bat!.stack).toBeUndefined();
    });

    it('computes voltage from v_cells_sum via toMilli', () => {
      const cache = makeBatteryCache();
      // v_cells_sum: IR(80) = 52000 → toMilli = 52.0V
      cache.set(80, 52000);
      const bat = buildBatterySnapshot(cache);
      expect(bat!.voltage).toBeCloseTo(52.0, 1);
    });
  });

  describe('buildBmuSnapshot', () => {
    function makeBmuCache(): Map<number, number> {
      const m = new Map<number, number>();
      // Serial number: IR(114-118) = 'HV12345678'
      // Note: BMU serial is at IR(114-118), not IR(110-114) like LV batteries
      const serial = 'HV12345678';
      for (let i = 0; i < 5; i++) {
        m.set(114 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
      }
      // 24 cell voltages: IR(60-83) = 3300 → toMilli = 3.3V
      for (let i = 0; i < 24; i++) {
        m.set(60 + i, 3300);
      }
      // 24 cell temperatures: IR(90-113) = 250 → toDeci = 25.0°C
      for (let i = 0; i < 24; i++) {
        m.set(90 + i, 250);
      }
      return m;
    }

    it('decodes BMU serial number from IR(114-118), not IR(110-114)', () => {
      const bmu = buildBmuSnapshot(makeBmuCache(), 0);
      expect(bmu).not.toBeNull();
      expect(bmu!.serialNumber).toBe('HV12345678');
    });

    it('decodes 24 cell voltages via toMilli (vs 16 for LV)', () => {
      const bmu = buildBmuSnapshot(makeBmuCache(), 0);
      expect(bmu!.cellVoltages).toHaveLength(24);
      expect(bmu!.cellVoltages[0]).toBeCloseTo(3.3, 2);
      expect(bmu!.cellVoltages[23]).toBeCloseTo(3.3, 2);
    });

    it('derives temperatureMax and temperatureMin from 24 cell temperatures', () => {
      const cache = makeBmuCache();
      cache.set(90, 280);  // cell 1: 28.0°C (hottest)
      cache.set(91, 220);  // cell 2: 22.0°C (coolest)
      const bmu = buildBmuSnapshot(cache, 0);
      expect(bmu!.temperatureMax).toBeCloseTo(28.0, 1);
      expect(bmu!.temperatureMin).toBeCloseTo(22.0, 1);
    });

    it('sets stack field to the provided BCU index', () => {
      const bmu = buildBmuSnapshot(makeBmuCache(), 2);
      expect(bmu!.stack).toBe(2);
    });

    it('returns null when all serial registers are zero (no module present)', () => {
      const cache = new Map<number, number>();
      for (let i = 0; i < 5; i++) {
        cache.set(114 + i, 0);
      }
      expect(buildBmuSnapshot(cache, 0)).toBeNull();
    });

    it('sets SOC, voltage, energy totals, and cycle count to 0 (BCU provides these)', () => {
      const bmu = buildBmuSnapshot(makeBmuCache(), 0);
      expect(bmu!.stateOfCharge).toBe(0);
      expect(bmu!.voltage).toBe(0);
      expect(bmu!.chargeEnergyTotalKwh).toBe(0);
      expect(bmu!.dischargeEnergyTotalKwh).toBe(0);
      expect(bmu!.cycleCount).toBe(0);
    });
  });

  describe('buildMeterSnapshot', () => {
    function makeMeterDataCache(): Map<number, number> {
      const m = new Map<number, number>();
      // Voltage — toDeci: 2432 → 243.2V (phase 1 only for single-phase)
      m.set(60, 2432);  // v_phase_1
      m.set(61, 0);     // v_phase_2
      m.set(62, 0);     // v_phase_3
      // Current — toCenti: 1523 → 15.23A
      m.set(63, 1523);  // i_phase_1
      m.set(64, 0);
      m.set(65, 0);
      // Active power — int16: 65236 unsigned → -300W (import)
      m.set(68, 65236); // p_active_phase_1 (0xFED4 = -300)
      m.set(69, 0);
      m.set(70, 0);
      m.set(71, 65236); // p_active_total
      // Reactive power — int16
      m.set(72, 100);   // 100 VAR
      m.set(73, 0);
      m.set(74, 0);
      m.set(75, 100);
      // Apparent power
      m.set(76, 320);   // 320 VA
      m.set(77, 0);
      m.set(78, 0);
      m.set(79, 320);
      // Power factor — int16 ÷ 10000: 9979 → 0.9979
      m.set(80, 9979);
      m.set(81, 0);
      m.set(82, 0);
      m.set(83, 9979);
      // Frequency — toCenti: 5001 → 50.01 Hz
      m.set(84, 5001);
      // Energy — toDeci: 50086 → 5008.6 kWh
      m.set(85, 50086); // e_import_active
      m.set(86, 100);   // e_import_reactive → 10.0
      m.set(87, 200);   // e_export_active → 20.0
      m.set(88, 50);    // e_export_reactive → 5.0
      return m;
    }

    function makeMeterProductCache(): Map<number, number> {
      const m = new Map<number, number>();
      // Serial number — uint32: (31 << 16) | 32006 = 2063622
      m.set(60, 31);    // high word
      m.set(61, 32006); // low word
      // Factory code — string: "GivE"
      m.set(62, (0x47 << 8) | 0x69); // "Gi"
      m.set(63, (0x76 << 8) | 0x45); // "vE"
      m.set(64, 1);     // meter_type
      m.set(65, 3);     // hardware_version
      m.set(66, 7);     // software_version
      return m;
    }

    it('builds a single-phase meter snapshot with correct scaling', () => {
      const meter = buildMeterSnapshot(0x01, makeMeterDataCache(), makeMeterProductCache());
      expect(meter).not.toBeNull();
      expect(meter!.slaveAddress).toBe(0x01);
      // Product info
      expect(meter!.serialNumber).toBe(2063622);
      expect(meter!.factoryCode).toBe('GivE');
      expect(meter!.meterType).toBe(1);
      expect(meter!.hardwareVersion).toBe(3);
      expect(meter!.softwareVersion).toBe(7);
    });

    it('applies toDeci for voltage (three-phase tuple shape)', () => {
      const meter = buildMeterSnapshot(0x01, makeMeterDataCache(), makeMeterProductCache());
      expect(meter!.voltage[0]).toBeCloseTo(243.2, 1);
      expect(meter!.voltage[1]).toBe(0);  // single-phase: phases 2 & 3 are 0
      expect(meter!.voltage[2]).toBe(0);
    });

    it('applies toCenti for current', () => {
      const meter = buildMeterSnapshot(0x01, makeMeterDataCache(), makeMeterProductCache());
      expect(meter!.current[0]).toBeCloseTo(15.23, 2);
    });

    it('applies toInt16 for signed active power (negative = import)', () => {
      const meter = buildMeterSnapshot(0x01, makeMeterDataCache(), makeMeterProductCache());
      expect(meter!.activePower[0]).toBe(-300);
      expect(meter!.activePowerTotal).toBe(-300);
    });

    it('applies toPowerFactor (÷10000) for power factor', () => {
      // Scaling verified against GivEnergy cloud CSV export.
      // GivTCP uses toMilli (÷1000), but ÷10000 matches the cloud CSV values.
      const meter = buildMeterSnapshot(0x01, makeMeterDataCache(), makeMeterProductCache());
      expect(meter!.powerFactor[0]).toBeCloseTo(0.9979, 4);
      expect(meter!.powerFactorTotal).toBeCloseTo(0.9979, 4);
    });

    it('applies toCenti for frequency', () => {
      const meter = buildMeterSnapshot(0x01, makeMeterDataCache(), makeMeterProductCache());
      expect(meter!.frequency).toBeCloseTo(50.01, 2);
    });

    it('applies toDeci for energy registers (single 16-bit, overflows at 6553.5 kWh)', () => {
      const meter = buildMeterSnapshot(0x01, makeMeterDataCache(), makeMeterProductCache());
      expect(meter!.importActiveEnergyKwh).toBeCloseTo(5008.6, 1);
      expect(meter!.exportActiveEnergyKwh).toBeCloseTo(20.0, 1);
    });

    it('returns null when v_phase_1 is 0 (no meter present)', () => {
      const data = makeMeterDataCache();
      data.set(60, 0); // v_phase_1 = 0 → no meter
      expect(buildMeterSnapshot(0x01, data, makeMeterProductCache())).toBeNull();
    });

    it('returns null when data cache is empty', () => {
      expect(buildMeterSnapshot(0x01, new Map(), new Map())).toBeNull();
    });

    it('handles negative power factor (import direction)', () => {
      const data = makeMeterDataCache();
      // 0xDF13 = 57107 unsigned → int16 = -8429 → ÷10000 = -0.8429
      data.set(80, 57107);
      data.set(83, 57107);
      const meter = buildMeterSnapshot(0x01, data, makeMeterProductCache());
      expect(meter!.powerFactor[0]).toBeCloseTo(-0.8429, 4);
    });

    it('builds with empty product cache (product info defaults to 0)', () => {
      const meter = buildMeterSnapshot(0x01, makeMeterDataCache(), new Map());
      expect(meter).not.toBeNull();
      expect(meter!.serialNumber).toBe(0);
      expect(meter!.factoryCode).toBe('\x00\x00\x00\x00');
    });

    it('integrates into inverter snapshot via meterRegisterCaches', () => {
      const cache = makeValidCache();
      const meterCaches = new Map([[0x01, {
        data: makeMeterDataCache(),
        product: makeMeterProductCache(),
      }]]);
      const snapshot = buildSnapshot(cache, { meterRegisterCaches: meterCaches });
      expect(snapshot!.meters).toHaveLength(1);
      expect(snapshot!.meters[0].serialNumber).toBe(2063622);
      expect(snapshot!.meters[0].slaveAddress).toBe(0x01);
    });

    it('returns empty meters array when no meter caches provided', () => {
      const snapshot = buildSnapshot(makeValidCache());
      expect(snapshot!.meters).toHaveLength(0);
    });

    it('falls back to phase 1 values for totals on single-phase meters', () => {
      // Single-phase meters (phases 2 & 3 voltage = 0) report 0 in "total" registers.
      // The builder should use phase 1 values as the totals.
      const data = makeMeterDataCache();
      // Set phase 1 values but totals to 0 (mimicking real single-phase meter behavior)
      data.set(71, 0);     // p_active_total = 0 (despite phase 1 having data)
      data.set(75, 0);     // p_reactive_total = 0
      data.set(79, 0);     // p_apparent_total = 0
      data.set(83, 0);     // pf_total = 0
      const meter = buildMeterSnapshot(0x01, data, makeMeterProductCache());
      // Should fall back to phase 1 values
      expect(meter!.activePowerTotal).toBe(-300);   // same as activePower[0]
      expect(meter!.reactivePowerTotal).toBe(100);   // same as reactivePower[0]
      expect(meter!.apparentPowerTotal).toBe(320);   // same as apparentPower[0]
      expect(meter!.powerFactorTotal).toBeCloseTo(0.9979, 4); // same as powerFactor[0]
    });

    it('does not apply single-phase fallback on three-phase meters', () => {
      // Three-phase meters have non-zero phases 2 & 3, so total 0 is genuine
      const data = makeMeterDataCache();
      data.set(61, 2400);  // v_phase_2 non-zero → three-phase
      data.set(62, 2400);  // v_phase_3 non-zero
      data.set(71, 0);     // p_active_total genuinely 0
      const meter = buildMeterSnapshot(0x01, data, makeMeterProductCache());
      expect(meter!.activePowerTotal).toBe(0);  // should NOT fall back to phase 1
    });

    it('does not apply fallback when phase 1 and total are both 0', () => {
      // When the meter is idle (e.g., no load), both phase 1 and total are 0 — no fallback needed
      const data = makeMeterDataCache();
      data.set(68, 0);     // p_active_phase_1 = 0
      data.set(71, 0);     // p_active_total = 0
      const meter = buildMeterSnapshot(0x01, data, makeMeterProductCache());
      expect(meter!.activePowerTotal).toBe(0);
    });
  });

  describe('parseBcuData', () => {
    function makeBcuCache(): Map<number, number> {
      const m = new Map<number, number>();
      m.set(64, 3);      // number_of_modules: 3 BMUs
      m.set(73, 3840);   // battery_voltage: 3840 → toDeci = 384.0V
      m.set(76, 50);     // battery_current: 50 → toInt16→toDeci = 5.0A
      m.set(79, 1920);   // battery_power: 1920 → toMilli = 1.92kW
      m.set(80, (95 << 8) | 90);  // soc_max=95, soc_min=90
      m.set(81, 98);     // battery_soh: 98%
      m.set(82, 0);      // charge_energy_total high
      m.set(83, 5000);   // charge_energy_total low → uint32→toDeci = 500.0 kWh
      m.set(84, 0);      // discharge_energy_total high
      m.set(85, 4500);   // discharge_energy_total low → uint32→toDeci = 450.0 kWh
      m.set(100, 150);   // number_of_cycles: 150 → toDeci = 15.0
      return m;
    }

    it('parses module count from IR(64)', () => {
      const bcu = parseBcuData(makeBcuCache());
      expect(bcu.numberOfModules).toBe(3);
    });

    it('parses charge and discharge energy totals as uint32 toDeci', () => {
      const bcu = parseBcuData(makeBcuCache());
      expect(bcu.chargeEnergyTotalKwh).toBeCloseTo(500.0, 1);
      expect(bcu.dischargeEnergyTotalKwh).toBeCloseTo(450.0, 1);
    });

    it('extracts SOC max from upper byte and SOC min from lower byte of IR(80)', () => {
      const bcu = parseBcuData(makeBcuCache());
      expect(bcu.stateOfChargeMax).toBe(95);
      expect(bcu.stateOfChargeMin).toBe(90);
    });

    it('parses cycle count via toDeci', () => {
      const bcu = parseBcuData(makeBcuCache());
      expect(bcu.cycleCount).toBeCloseTo(15.0, 1);
    });
  });
});
