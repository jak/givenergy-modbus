import { describe, it, expect } from 'vitest';
import { buildSnapshot, buildBatterySnapshot, type RegisterCache } from '../src/snapshot-builder.js';

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
 *   IR(52)  = p_battery (signed, positive=charging)
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

  // Device type code: HR(0)
  hr.set(0, 0x2003);

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

/** Gen2 cache: CE prefix serial → gen2 generation */
function makeGen2Cache(): RegisterCache {
  const cache = makeValidCache();
  const serial = 'CE1234B567';
  for (let i = 0; i < 5; i++) {
    cache.holdingRegisters.set(13 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }
  return cache;
}

/** Three-phase cache: SA prefix serial → three_phase generation */
function makeThreePhaseCache(): RegisterCache {
  const cache = makeValidCache();
  const serial = 'SA1234B567';
  for (let i = 0; i < 5; i++) {
    cache.holdingRegisters.set(13 + i, (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1));
  }
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
      expect(snapshot!.modelCode).toBe(0x2003);
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

    it('sets generation field from serial prefix', () => {
      // EE prefix → gen3
      const gen3Snapshot = buildSnapshot(makeValidCache());
      expect(gen3Snapshot!.generation).toBe('gen3');

      // SA prefix → three_phase
      const threePhaseCache = makeThreePhaseCache();
      const threePhaseSnapshot = buildSnapshot(threePhaseCache);
      expect(threePhaseSnapshot!.generation).toBe('three_phase');

      // CE prefix → gen2
      const gen2Cache = makeGen2Cache();
      const gen2Snapshot = buildSnapshot(gen2Cache);
      expect(gen2Snapshot!.generation).toBe('gen2');
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

    it('computes solar power as p_pv1 + p_pv2', () => {
      const cache = makeValidCache();
      cache.inputRegisters.set(18, 1500); // p_pv1: 1500W
      cache.inputRegisters.set(20, 800);  // p_pv2: 800W
      const snapshot = buildSnapshot(cache);
      expect(snapshot!.solarPower).toBe(2300);
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

    it('computes voltage from v_cells_sum via toMilli', () => {
      const cache = makeBatteryCache();
      // v_cells_sum: IR(80) = 52000 → toMilli = 52.0V
      cache.set(80, 52000);
      const bat = buildBatterySnapshot(cache);
      expect(bat!.voltage).toBeCloseTo(52.0, 1);
    });
  });
});
