import { describe, it, expect } from 'vitest';
import { detectModel, isHighVoltage, DeviceType } from '../src/model/device-types.js';
import { detectBatteries } from '../src/model/plant.js';

describe('Model Detection', () => {
  describe('detectModel from HR(0) device_type_code', () => {
    it('detects HYBRID_GEN3 from device type code 0x2xxx with ARM FW ~300', () => {
      // Python: hex(0x2003)[2:3] = "2" → hybrid family
      // ARM FW 300 / 100 = 3 → Gen3
      // In JS: (0x2003).toString(16) = "2003", first char = "2"
      const model = detectModel(0x2003, 300);
      expect(model).toBe(DeviceType.HYBRID_GEN3);
    });

    it('detects HYBRID_GEN1 for firmware < 200', () => {
      // ARM FW 100 / 100 = 1 → Gen1 (not 3, not 8 or 9)
      const model = detectModel(0x2001, 100);
      expect(model).toBe(DeviceType.HYBRID_GEN1);
    });

    it('detects HYBRID_GEN2 for firmware 800', () => {
      // ARM FW 800 / 100 = 8 → Gen2
      const model = detectModel(0x2001, 800);
      expect(model).toBe(DeviceType.HYBRID_GEN2);
    });

    it('detects HYBRID_GEN2 for firmware 900', () => {
      const model = detectModel(0x2001, 900);
      expect(model).toBe(DeviceType.HYBRID_GEN2);
    });

    it('detects AC from hex prefix "3"', () => {
      // hex(0x3001)[2:3] = "3" → AC inverter
      const model = detectModel(0x3001, 0);
      expect(model).toBe(DeviceType.AC);
    });

    it('detects HYBRID_3PH from hex prefix "4"', () => {
      const model = detectModel(0x4001, 0);
      expect(model).toBe(DeviceType.HYBRID_3PH);
    });

    it('detects EMS from hex prefix "5"', () => {
      const model = detectModel(0x5001, 0);
      expect(model).toBe(DeviceType.EMS);
    });

    it('detects GATEWAY from hex prefix "7"', () => {
      const model = detectModel(0x7001, 0);
      expect(model).toBe(DeviceType.GATEWAY);
    });

    it('detects ALL_IN_ONE from hex prefix "8"', () => {
      const model = detectModel(0x8001, 0);
      expect(model).toBe(DeviceType.ALL_IN_ONE);
    });
  });

  describe('isHighVoltage', () => {
    it('returns true for ALL_IN_ONE', () => {
      expect(isHighVoltage(DeviceType.ALL_IN_ONE)).toBe(true);
    });

    it('returns true for HYBRID_3PH', () => {
      expect(isHighVoltage(DeviceType.HYBRID_3PH)).toBe(true);
    });

    it('returns true for HYBRID_HV_GEN3', () => {
      expect(isHighVoltage(DeviceType.HYBRID_HV_GEN3)).toBe(true);
    });

    it('returns false for HYBRID_GEN3 (low voltage)', () => {
      expect(isHighVoltage(DeviceType.HYBRID_GEN3)).toBe(false);
    });

    it('returns false for AC', () => {
      expect(isHighVoltage(DeviceType.AC)).toBe(false);
    });

    it('returns false for HYBRID_GEN1', () => {
      expect(isHighVoltage(DeviceType.HYBRID_GEN1)).toBe(false);
    });
  });

  describe('Battery Detection', () => {
    it('counts LV batteries by checking serial number register validity', () => {
      // LV batteries at slave addresses 0x32 (battery 1) through 0x37 (battery 6).
      // A battery exists if its serial_number (IR 110-114) is not all-null or all-spaces.
      // Stops at the first invalid battery.
      const registerCache = new Map<number, Map<number, number>>();

      // Battery 1 at 0x32: valid serial "CE1234G001"
      const bat1 = new Map<number, number>();
      const serial1 = 'CE1234G001';
      for (let i = 0; i < 5; i++) {
        bat1.set(110 + i, (serial1.charCodeAt(i * 2) << 8) | serial1.charCodeAt(i * 2 + 1));
      }
      registerCache.set(0x32, bat1);

      // Battery 2 at 0x33: valid serial "CE1234G002"
      const bat2 = new Map<number, number>();
      const serial2 = 'CE1234G002';
      for (let i = 0; i < 5; i++) {
        bat2.set(110 + i, (serial2.charCodeAt(i * 2) << 8) | serial2.charCodeAt(i * 2 + 1));
      }
      registerCache.set(0x33, bat2);

      // Battery 3 at 0x34: null serial (no battery)
      const bat3 = new Map<number, number>();
      for (let i = 0; i < 5; i++) {
        bat3.set(110 + i, 0x0000);
      }
      registerCache.set(0x34, bat3);

      expect(detectBatteries(registerCache, false)).toBe(2);
    });

    it('returns 0 batteries for EMS devices', () => {
      // EMS and Gateway manage batteries indirectly.
      expect(detectBatteries(new Map(), false, DeviceType.EMS)).toBe(0);
    });

    it('returns 0 batteries for GATEWAY devices', () => {
      expect(detectBatteries(new Map(), false, DeviceType.GATEWAY)).toBe(0);
    });

    it('returns 0 when no battery caches are populated', () => {
      expect(detectBatteries(new Map(), false)).toBe(0);
    });

    it('returns 0 for HV devices (BCU-based, different detection)', () => {
      // HV batteries use slave addresses 0x70+ (BCUs), not 0x32-0x37.
      // LV battery detection is skipped for HV devices.
      expect(detectBatteries(new Map(), true)).toBe(0);
    });
  });
});
