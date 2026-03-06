/**
 * Register Lookup Tables for GivEnergy inverter Modbus registers.
 *
 * Defines all known registers as typed constants so the rest of the library
 * can refer to registers by name rather than magic numbers.
 *
 * Reference: GivTCP/givenergy_modbus_async/model/
 */

import type { RegisterType } from './register-types.js';

export interface RegisterDef {
  type: RegisterType;
  address: number;
  /** For multi-register values (uint32, string, timeslot, datetime): number of consecutive registers */
  length?: number;
}

/**
 * Model detection registers — read first to determine which register set applies.
 * Both are holding registers on the main inverter slave address.
 */
export const MODEL_REGISTERS: {
  device_type_code: RegisterDef;
  arm_firmware_version: RegisterDef;
} = {
  /** HR(0) — THE most critical register. Determines model, slave addressing,
   *  HV vs LV architecture. Parsed by extracting the 2nd hex digit. */
  device_type_code: { type: 'HR', address: 0 },
  /** HR(21) — Used to distinguish Gen1 / Gen2 / Gen3 hybrid models.
   *  ARM FW / 100: 3 = Gen3, 8–9 = Gen2, else = Gen1 */
  arm_firmware_version: { type: 'HR', address: 21 },
};

/**
 * Holding registers on the main inverter slave address (read/write).
 * Function code 0x03 read, 0x06 write.
 */
export const INVERTER_HOLDING_REGISTERS: Record<string, RegisterDef> = {
  // ── Block 0–59 ──────────────────────────────────────────────────────────────
  device_type_code: { type: 'HR', address: 0 },
  enable_ammeter: { type: 'HR', address: 7 },
  /** 5 registers × 2 bytes each = 10-char serial number */
  first_battery_serial_number: { type: 'HR', address: 8, length: 5 },
  /** 5 registers × 2 bytes each = 10-char serial number */
  serial_number: { type: 'HR', address: 13, length: 5 },
  first_battery_bms_firmware_version: { type: 'HR', address: 18 },
  dsp_firmware_version: { type: 'HR', address: 19 },
  enable_charge_target: { type: 'HR', address: 20 },
  arm_firmware_version: { type: 'HR', address: 21 },
  usb_device_inserted: { type: 'HR', address: 22 },
  select_arm_chip: { type: 'HR', address: 23 },
  variable_address: { type: 'HR', address: 24 },
  variable_value: { type: 'HR', address: 25 },
  grid_port_max_power_output: { type: 'HR', address: 26 },
  eco_mode: { type: 'HR', address: 27 },
  enable_60hz_freq_mode: { type: 'HR', address: 28 },
  soc_force_adjust: { type: 'HR', address: 29 },
  modbus_address: { type: 'HR', address: 30 },
  charge_slot_2_start: { type: 'HR', address: 31 },
  charge_slot_2_end: { type: 'HR', address: 32 },
  user_code: { type: 'HR', address: 33 },
  modbus_version: { type: 'HR', address: 34 },
  /** 6 registers: year, month, day, hour, minute, second */
  system_time: { type: 'HR', address: 35, length: 6 },
  enable_drm_rj45_port: { type: 'HR', address: 41 },
  enable_reversed_ct_clamp: { type: 'HR', address: 42 },
  discharge_slot_2_start: { type: 'HR', address: 44 },
  discharge_slot_2_end: { type: 'HR', address: 45 },
  bms_firmware_version: { type: 'HR', address: 46 },
  meter_type: { type: 'HR', address: 47 },
  enable_reversed_115_meter: { type: 'HR', address: 48 },
  enable_reversed_418_meter: { type: 'HR', address: 49 },
  active_power_rate: { type: 'HR', address: 50 },
  reactive_power_rate: { type: 'HR', address: 51 },
  power_factor: { type: 'HR', address: 52 },
  battery_type: { type: 'HR', address: 54 },
  discharge_slot_1_start: { type: 'HR', address: 56 },
  discharge_slot_1_end: { type: 'HR', address: 57 },
  enable_auto_judge_battery_type: { type: 'HR', address: 58 },
  enable_discharge: { type: 'HR', address: 59 },

  // ── Block 60–119 ────────────────────────────────────────────────────────────
  v_pv_start: { type: 'HR', address: 60 },
  start_countdown_timer: { type: 'HR', address: 61 },
  restart_delay_time: { type: 'HR', address: 62 },
  charge_slot_1_start: { type: 'HR', address: 94 },
  charge_slot_1_end: { type: 'HR', address: 95 },
  enable_charge: { type: 'HR', address: 96 },
  battery_low_voltage_protection_limit: { type: 'HR', address: 97 },
  battery_high_voltage_protection_limit: { type: 'HR', address: 98 },
  battery_voltage_adjust: { type: 'HR', address: 105 },
  battery_low_force_charge_time: { type: 'HR', address: 108 },
  enable_bms_read: { type: 'HR', address: 109 },
  battery_soc_reserve: { type: 'HR', address: 110 },
  battery_charge_limit: { type: 'HR', address: 111 },
  battery_discharge_limit: { type: 'HR', address: 112 },
  enable_buzzer: { type: 'HR', address: 113 },
  battery_discharge_min_power_reserve: { type: 'HR', address: 114 },
  charge_target_soc: { type: 'HR', address: 116 },
  charge_soc_stop_2: { type: 'HR', address: 117 },
  discharge_soc_stop_2: { type: 'HR', address: 118 },
  charge_soc_stop_1: { type: 'HR', address: 119 },

  // ── Block 120–179 ───────────────────────────────────────────────────────────
  discharge_soc_stop_1: { type: 'HR', address: 120 },
  enable_local_command_test: { type: 'HR', address: 121 },
  power_factor_function_model: { type: 'HR', address: 122 },
  frequency_load_limit_rate: { type: 'HR', address: 123 },
  enable_low_voltage_fault_ride_through: { type: 'HR', address: 124 },
  enable_frequency_derating: { type: 'HR', address: 125 },
  enable_above_6kw_system: { type: 'HR', address: 126 },
  start_system_auto_test: { type: 'HR', address: 127 },
  enable_spi: { type: 'HR', address: 128 },
  inverter_reboot: { type: 'HR', address: 163 },
  rtc_enable: { type: 'HR', address: 166 },
  threephase_balance_mode: { type: 'HR', address: 167 },
  threephase_abc: { type: 'HR', address: 168 },
  threephase_balance_1: { type: 'HR', address: 169 },
  threephase_balance_2: { type: 'HR', address: 170 },
  threephase_balance_3: { type: 'HR', address: 171 },
  enable_battery_on_pv_or_grid: { type: 'HR', address: 175 },
  debug_inverter: { type: 'HR', address: 176 },
  enable_ups_mode: { type: 'HR', address: 177 },
  enable_g100_limit_switch: { type: 'HR', address: 178 },
  enable_battery_cable_impedance_alarm: { type: 'HR', address: 179 },

  // ── Block 180–239 ───────────────────────────────────────────────────────────
  /** Backup energy register (old firmware) — note: HR not IR despite similar name */
  e_battery_discharge_total_2: { type: 'HR', address: 180 },
  enable_standard_self_consumption_logic: { type: 'HR', address: 199 },
  cmd_bms_flash_update: { type: 'HR', address: 200 },

  // ── Gen3 timeslots ──────────────────────────────────────────────────────────
  inverter_errors: { type: 'HR', address: 223, length: 2 },
  charge_target_soc_1: { type: 'HR', address: 242 },
  charge_slot_3_start: { type: 'HR', address: 246 },
  charge_slot_3_end: { type: 'HR', address: 247 },
  charge_target_soc_3: { type: 'HR', address: 248 },
  charge_slot_4_start: { type: 'HR', address: 249 },
  charge_slot_4_end: { type: 'HR', address: 250 },
  charge_target_soc_4: { type: 'HR', address: 251 },
  charge_slot_5_start: { type: 'HR', address: 252 },
  charge_slot_5_end: { type: 'HR', address: 253 },
  charge_target_soc_5: { type: 'HR', address: 254 },
  charge_slot_6_start: { type: 'HR', address: 255 },
  charge_slot_6_end: { type: 'HR', address: 256 },
  charge_target_soc_6: { type: 'HR', address: 257 },
  charge_slot_7_start: { type: 'HR', address: 258 },
  charge_slot_7_end: { type: 'HR', address: 259 },
  charge_target_soc_7: { type: 'HR', address: 260 },
  charge_slot_8_start: { type: 'HR', address: 261 },
  charge_slot_8_end: { type: 'HR', address: 262 },
  charge_target_soc_8: { type: 'HR', address: 263 },
  charge_slot_9_start: { type: 'HR', address: 264 },
  charge_slot_9_end: { type: 'HR', address: 265 },
  charge_target_soc_9: { type: 'HR', address: 266 },
  charge_slot_10_start: { type: 'HR', address: 267 },
  charge_slot_10_end: { type: 'HR', address: 268 },
  charge_target_soc_10: { type: 'HR', address: 269 },
  discharge_target_soc_1: { type: 'HR', address: 272 },
  discharge_target_soc_2: { type: 'HR', address: 275 },
  discharge_slot_3_start: { type: 'HR', address: 276 },
  discharge_slot_3_end: { type: 'HR', address: 277 },
  discharge_target_soc_3: { type: 'HR', address: 278 },
  discharge_slot_4_start: { type: 'HR', address: 279 },
  discharge_slot_4_end: { type: 'HR', address: 280 },
  discharge_target_soc_4: { type: 'HR', address: 281 },
  discharge_slot_5_start: { type: 'HR', address: 282 },
  discharge_slot_5_end: { type: 'HR', address: 283 },
  discharge_target_soc_5: { type: 'HR', address: 284 },
  discharge_slot_6_start: { type: 'HR', address: 285 },
  discharge_slot_6_end: { type: 'HR', address: 286 },
  discharge_target_soc_6: { type: 'HR', address: 287 },
  discharge_slot_7_start: { type: 'HR', address: 288 },
  discharge_slot_7_end: { type: 'HR', address: 289 },
  discharge_target_soc_7: { type: 'HR', address: 290 },
  discharge_slot_8_start: { type: 'HR', address: 291 },
  discharge_slot_8_end: { type: 'HR', address: 292 },
  discharge_target_soc_8: { type: 'HR', address: 293 },
  discharge_slot_9_start: { type: 'HR', address: 294 },
  discharge_slot_9_end: { type: 'HR', address: 295 },
  discharge_target_soc_9: { type: 'HR', address: 296 },
  discharge_slot_10_start: { type: 'HR', address: 297 },
  discharge_slot_10_end: { type: 'HR', address: 298 },
  discharge_target_soc_10: { type: 'HR', address: 299 },

  // ── Block 300+ (Single Phase New registers) ─────────────────────────────────
  battery_charge_limit_ac: { type: 'HR', address: 313 },
  battery_discharge_limit_ac: { type: 'HR', address: 314 },
  battery_pause_mode: { type: 'HR', address: 318 },
  battery_pause_slot_1_start: { type: 'HR', address: 319 },
  battery_pause_slot_1_end: { type: 'HR', address: 320 },
};

/**
 * Input registers on the main inverter slave address (read-only).
 * Function code 0x04 read.
 */
export const INVERTER_INPUT_REGISTERS: Record<string, RegisterDef> = {
  // ── Block 0–59 ──────────────────────────────────────────────────────────────
  status: { type: 'IR', address: 0 },
  v_pv1: { type: 'IR', address: 1 },
  v_pv2: { type: 'IR', address: 2 },
  v_p_bus: { type: 'IR', address: 3 },
  v_n_bus: { type: 'IR', address: 4 },
  v_ac1: { type: 'IR', address: 5 },
  /** uint32 spanning 2 registers */
  e_battery_throughput_total: { type: 'IR', address: 6, length: 2 },
  i_pv1: { type: 'IR', address: 8 },
  i_pv2: { type: 'IR', address: 9 },
  i_ac1: { type: 'IR', address: 10 },
  /** uint32 spanning 2 registers — total PV energy generated */
  e_pv_total: { type: 'IR', address: 11, length: 2 },
  f_ac1: { type: 'IR', address: 13 },
  v_highbrigh_bus: { type: 'IR', address: 15 },
  e_pv1_day: { type: 'IR', address: 17 },
  p_pv1: { type: 'IR', address: 18 },
  e_pv2_day: { type: 'IR', address: 19 },
  p_pv2: { type: 'IR', address: 20 },
  /** uint32 spanning 2 registers */
  e_grid_out_total: { type: 'IR', address: 21, length: 2 },
  e_solar_diverter: { type: 'IR', address: 23 },
  /** signed int16 */
  p_inverter_out: { type: 'IR', address: 24 },
  e_grid_out_day: { type: 'IR', address: 25 },
  e_grid_in_day: { type: 'IR', address: 26 },
  /** uint32 spanning 2 registers */
  e_inverter_in_total: { type: 'IR', address: 27, length: 2 },
  e_discharge_year: { type: 'IR', address: 29 },
  /** signed int16 — positive = export (grid out), negative = import */
  p_grid_out: { type: 'IR', address: 30 },
  p_eps_backup: { type: 'IR', address: 31 },
  /** uint32 spanning 2 registers */
  e_grid_in_total: { type: 'IR', address: 32, length: 2 },
  e_inverter_in_day: { type: 'IR', address: 35 },
  e_battery_charge_today: { type: 'IR', address: 36 },
  e_battery_discharge_today: { type: 'IR', address: 37 },
  inverter_countdown: { type: 'IR', address: 38 },
  /** signed; value > 100°C indicates corrupt/unreliable data */
  temp_inverter_heatsink: { type: 'IR', address: 41 },
  p_load_demand: { type: 'IR', address: 42 },
  p_grid_apparent: { type: 'IR', address: 43 },
  e_inverter_out_day: { type: 'IR', address: 44 },
  /** uint32 spanning 2 registers */
  e_inverter_out_total: { type: 'IR', address: 45, length: 2 },
  /** uint32 spanning 2 registers */
  work_time_total: { type: 'IR', address: 47, length: 2 },
  system_mode: { type: 'IR', address: 49 },
  v_battery: { type: 'IR', address: 50 },
  /** signed int16 */
  i_battery: { type: 'IR', address: 51 },
  /** signed int16 — positive = discharging, negative = charging */
  p_battery: { type: 'IR', address: 52 },
  v_eps_backup: { type: 'IR', address: 53 },
  f_eps_backup: { type: 'IR', address: 54 },
  temp_charger: { type: 'IR', address: 55 },
  temp_battery: { type: 'IR', address: 56 },
  i_grid_port: { type: 'IR', address: 58 },
  /** Main inverter-level SOC — source of the SOC fallback chain */
  battery_percent: { type: 'IR', address: 59 },

  // ── Block 180–183 ───────────────────────────────────────────────────────────
  /** Backup energy register (old firmware) */
  e_battery_discharge_total_2: { type: 'IR', address: 180 },
  /** Backup energy register (old firmware) */
  e_battery_charge_total_2: { type: 'IR', address: 181 },
  e_battery_discharge_today_2: { type: 'IR', address: 182 },
  e_battery_charge_today_2: { type: 'IR', address: 183 },

  // ── Block 247–248 (Gen3) ────────────────────────────────────────────────────
  /** uint32 spanning 2 registers — combined PV + other generation */
  p_combined_generation: { type: 'IR', address: 247, length: 2 },
};

/**
 * Input registers in the battery slave address space (0x32–0x37).
 * Function code 0x04 read. Addresses are relative to the battery's slave address.
 */
export const BATTERY_REGISTERS: Record<string, RegisterDef> = {
  // ── Block 60–119 ────────────────────────────────────────────────────────────
  v_cell_01: { type: 'IR', address: 60 },
  v_cell_02: { type: 'IR', address: 61 },
  v_cell_03: { type: 'IR', address: 62 },
  v_cell_04: { type: 'IR', address: 63 },
  v_cell_05: { type: 'IR', address: 64 },
  v_cell_06: { type: 'IR', address: 65 },
  v_cell_07: { type: 'IR', address: 66 },
  v_cell_08: { type: 'IR', address: 67 },
  v_cell_09: { type: 'IR', address: 68 },
  v_cell_10: { type: 'IR', address: 69 },
  v_cell_11: { type: 'IR', address: 70 },
  v_cell_12: { type: 'IR', address: 71 },
  v_cell_13: { type: 'IR', address: 72 },
  v_cell_14: { type: 'IR', address: 73 },
  v_cell_15: { type: 'IR', address: 74 },
  v_cell_16: { type: 'IR', address: 75 },
  t_cells_01_04: { type: 'IR', address: 76 },
  t_cells_05_08: { type: 'IR', address: 77 },
  t_cells_09_12: { type: 'IR', address: 78 },
  t_cells_13_16: { type: 'IR', address: 79 },
  v_cells_sum: { type: 'IR', address: 80 },
  t_bms_mosfet: { type: 'IR', address: 81 },
  /** uint32 spanning 2 registers */
  v_out: { type: 'IR', address: 82, length: 2 },
  /** uint32 spanning 2 registers — calibrated capacity in Ah */
  cap_calibrated: { type: 'IR', address: 84, length: 2 },
  /** uint32 spanning 2 registers — design capacity in Ah */
  cap_design: { type: 'IR', address: 86, length: 2 },
  /** uint32 spanning 2 registers — remaining capacity in Ah (×0.01) */
  cap_remaining: { type: 'IR', address: 88, length: 2 },
  status_1: { type: 'IR', address: 90 },
  status_2: { type: 'IR', address: 90 },
  status_3: { type: 'IR', address: 91 },
  status_4: { type: 'IR', address: 91 },
  status_5: { type: 'IR', address: 92 },
  status_6: { type: 'IR', address: 92 },
  status_7: { type: 'IR', address: 93 },
  warning_1: { type: 'IR', address: 94 },
  warning_2: { type: 'IR', address: 94 },
  num_cycles: { type: 'IR', address: 96 },
  num_cells: { type: 'IR', address: 97 },
  bms_firmware_version: { type: 'IR', address: 98 },
  /** Per-battery state of charge */
  soc: { type: 'IR', address: 100 },
  /** uint32 spanning 2 registers */
  cap_design2: { type: 'IR', address: 101, length: 2 },
  t_max: { type: 'IR', address: 103 },
  t_min: { type: 'IR', address: 104 },
  e_battery_discharge_total: { type: 'IR', address: 105 },
  e_battery_charge_total: { type: 'IR', address: 106 },
  /** 5 registers × 2 bytes = 10-char serial number; null = no battery at this address */
  serial_number: { type: 'IR', address: 110, length: 5 },
  usb_device_inserted: { type: 'IR', address: 115 },
};

/**
 * Input registers in the CT meter slave address space (0x01–0x08).
 * Function code 0x04 read. Addresses are relative to the meter's slave address.
 */
export const METER_REGISTERS: Record<string, RegisterDef> = {
  // ── Block 60–88 (fc=4, read input registers) ─────────────────────────────────
  // Scaling verified against GivEnergy cloud CSV export (2026-03-06)
  /** toDeci → V */
  v_phase_1: { type: 'IR', address: 60 },
  v_phase_2: { type: 'IR', address: 61 },
  v_phase_3: { type: 'IR', address: 62 },
  /** toCenti → A */
  i_phase_1: { type: 'IR', address: 63 },
  i_phase_2: { type: 'IR', address: 64 },
  i_phase_3: { type: 'IR', address: 65 },
  i_ln: { type: 'IR', address: 66 },
  i_total: { type: 'IR', address: 67 },
  /** int16 → W (signed: negative = import, positive = export) */
  p_active_phase_1: { type: 'IR', address: 68 },
  p_active_phase_2: { type: 'IR', address: 69 },
  p_active_phase_3: { type: 'IR', address: 70 },
  p_active_total: { type: 'IR', address: 71 },
  /** int16 → VAR */
  p_reactive_phase_1: { type: 'IR', address: 72 },
  p_reactive_phase_2: { type: 'IR', address: 73 },
  p_reactive_phase_3: { type: 'IR', address: 74 },
  p_reactive_total: { type: 'IR', address: 75 },
  /** int16 → VA */
  p_apparent_phase_1: { type: 'IR', address: 76 },
  p_apparent_phase_2: { type: 'IR', address: 77 },
  p_apparent_phase_3: { type: 'IR', address: 78 },
  p_apparent_total: { type: 'IR', address: 79 },
  /** int16, ÷10000 → power factor -1.0..1.0 (GivTCP uses toMilli ÷1000, but ÷10000 matches cloud CSV) */
  pf_phase_1: { type: 'IR', address: 80 },
  pf_phase_2: { type: 'IR', address: 81 },
  pf_phase_3: { type: 'IR', address: 82 },
  pf_total: { type: 'IR', address: 83 },
  /** toCenti → Hz */
  frequency: { type: 'IR', address: 84 },
  /** toDeci → kWh (single 16-bit, overflows at 6553.5 kWh) */
  e_import_active: { type: 'IR', address: 85 },
  e_import_reactive: { type: 'IR', address: 86 },
  e_export_active: { type: 'IR', address: 87 },
  e_export_reactive: { type: 'IR', address: 88 },
};

/**
 * Product info registers on the CT meter slave address space (0x01–0x08).
 * Function code 0x16 (22) read — GivEnergy custom, NOT standard Modbus.
 * Addresses are relative to the meter's slave address.
 */
export const METER_PRODUCT_REGISTERS: Record<string, RegisterDef> = {
  /** uint32 from MR(60,61) — numeric serial, NOT a string */
  serial_number: { type: 'IR', address: 60, length: 2 },
  /** 2 registers × 2 bytes = 4-char factory code string (e.g. "GivE") */
  factory_code: { type: 'IR', address: 62, length: 2 },
  meter_type: { type: 'IR', address: 64 },
  hardware_version: { type: 'IR', address: 65 },
  software_version: { type: 'IR', address: 66 },
  modbus_id: { type: 'IR', address: 67 },
  baud_rate: { type: 'IR', address: 68 },
};
