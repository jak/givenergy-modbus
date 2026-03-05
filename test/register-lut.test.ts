import { describe, it, expect } from 'vitest';
import {
  INVERTER_INPUT_REGISTERS,
  INVERTER_HOLDING_REGISTERS,
  BATTERY_REGISTERS,
  METER_REGISTERS,
  MODEL_REGISTERS,
} from '../src/model/register-lut.js';

describe('Register Lookup Tables', () => {
  describe('MODEL_REGISTERS', () => {
    it('defines device_type_code at HR(0)', () => {
      // THE most critical register — determines model, slave addressing,
      // HV vs LV architecture, and register set support.
      // Parsed by extracting the 2nd hex digit (fragile but necessary).
      expect(MODEL_REGISTERS.device_type_code.type).toBe('HR');
      expect(MODEL_REGISTERS.device_type_code.address).toBe(0);
    });

    it('defines arm_firmware_version at HR(21)', () => {
      // Used to distinguish Gen1 / Gen2 / Gen3 hybrid models.
      // ARM FW / 100: 3 = Gen3, 8-9 = Gen2, else = Gen1
      expect(MODEL_REGISTERS.arm_firmware_version.type).toBe('HR');
      expect(MODEL_REGISTERS.arm_firmware_version.address).toBe(21);
    });
  });

  describe('INVERTER_INPUT_REGISTERS', () => {
    it('defines battery_percent at IR(59)', () => {
      // Main inverter-level SOC. Source of the SOC fallback chain.
      expect(INVERTER_INPUT_REGISTERS['battery_percent'].type).toBe('IR');
      expect(INVERTER_INPUT_REGISTERS['battery_percent'].address).toBe(59);
    });

    it('defines p_pv1 at IR(18) and p_pv2 at IR(20)', () => {
      expect(INVERTER_INPUT_REGISTERS['p_pv1'].address).toBe(18);
      expect(INVERTER_INPUT_REGISTERS['p_pv2'].address).toBe(20);
    });

    it('defines p_grid_out at IR(30) — signed, positive=export', () => {
      // Counter-intuitive sign convention: positive = export (grid out),
      // negative = import. Many integrations get confused by this.
      expect(INVERTER_INPUT_REGISTERS['p_grid_out'].address).toBe(30);
    });

    it('defines temp_inverter_heatsink at IR(41)', () => {
      // Used in sanity check: value > 100°C indicates corrupt data
      expect(INVERTER_INPUT_REGISTERS['temp_inverter_heatsink'].address).toBe(41);
    });

    it('defines p_battery at IR(52) — signed', () => {
      // Battery power: positive = charging, negative = discharging
      expect(INVERTER_INPUT_REGISTERS['p_battery'].address).toBe(52);
    });

    it('defines e_pv_total as 2-register uint32 at IR(11)', () => {
      // Energy totals span two registers (high word + low word = 32-bit)
      expect(INVERTER_INPUT_REGISTERS['e_pv_total'].address).toBe(11);
      expect(INVERTER_INPUT_REGISTERS['e_pv_total'].length).toBe(2);
    });
  });

  describe('INVERTER_HOLDING_REGISTERS', () => {
    it('defines serial_number spanning HR(13-17)', () => {
      // 5 registers × 2 bytes each = 10-char serial number
      expect(INVERTER_HOLDING_REGISTERS['serial_number'].type).toBe('HR');
      expect(INVERTER_HOLDING_REGISTERS['serial_number'].address).toBe(13);
      expect(INVERTER_HOLDING_REGISTERS['serial_number'].length).toBe(5);
    });

    it('defines charge_slot_1_start at HR(94)', () => {
      expect(INVERTER_HOLDING_REGISTERS['charge_slot_1_start'].address).toBe(94);
    });

    it('defines enable_charge at HR(96)', () => {
      expect(INVERTER_HOLDING_REGISTERS['enable_charge'].address).toBe(96);
    });

    it('defines charge_target_soc at HR(116)', () => {
      expect(INVERTER_HOLDING_REGISTERS['charge_target_soc'].address).toBe(116);
    });
  });

  describe('BATTERY_REGISTERS', () => {
    it('defines soc at IR(100)', () => {
      // Per-battery SOC, read from each battery slave address (0x32-0x37)
      expect(BATTERY_REGISTERS['soc'].type).toBe('IR');
      expect(BATTERY_REGISTERS['soc'].address).toBe(100);
    });

    it('defines serial_number spanning IR(110-114)', () => {
      // Battery validity check: null serial = no battery present at that address.
      // This is how LV battery count is determined.
      expect(BATTERY_REGISTERS['serial_number'].address).toBe(110);
      expect(BATTERY_REGISTERS['serial_number'].length).toBe(5);
    });

    it('defines all 16 cell voltage registers IR(60-75)', () => {
      for (let i = 1; i <= 16; i++) {
        const key = `v_cell_${String(i).padStart(2, '0')}`;
        expect(BATTERY_REGISTERS[key], `${key} should exist`).toBeDefined();
        expect(BATTERY_REGISTERS[key].address).toBe(59 + i);
      }
    });

    it('defines cap_remaining as 2-register value at IR(88)', () => {
      // Remaining capacity in Ah (×0.01) spans two registers
      expect(BATTERY_REGISTERS['cap_remaining'].address).toBe(88);
      expect(BATTERY_REGISTERS['cap_remaining'].length).toBe(2);
    });
  });

  describe('METER_REGISTERS', () => {
    it('defines v_phase_1 at IR(60)', () => {
      expect(METER_REGISTERS['v_phase_1'].address).toBe(60);
    });

    it('defines p_active_total at IR(71)', () => {
      expect(METER_REGISTERS['p_active_total'].address).toBe(71);
    });
  });
});
