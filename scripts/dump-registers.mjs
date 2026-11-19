import { existsSync } from 'fs';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('Error: dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

const { GivEnergyInverter, discover } = await import('../dist/index.js');

const args = process.argv.slice(2);
const debug = args.includes('--debug');
let host = args.find(a => a !== '--debug');

if (!host) {
  console.log('No host specified, auto-discovering...');
  const devices = await discover();
  if (devices.length === 0) {
    console.error('No GivEnergy inverters found. Provide a host as the first argument.');
    process.exit(1);
  }
  host = devices[0].host;
  console.log(`Using ${host}`);
}

// Holding register names. Based on GivTCP's map (givenergy_modbus_async/model/baseinverter.py),
// corrected where the official GivEnergy app's Direct Control screen disagrees. Quoted names
// are the app's labels; see website/register-map.md for the cross-check against a Gen3 Hybrid.
const REGISTER_NAMES = {
  0: 'device_type_code',
  3: 'num_mppt',
  7: 'enable_ammeter',
  8: 'first_battery_serial [8-12]',
  13: 'serial_number [13-17]',
  18: 'first_battery_bms_firmware_version',
  19: 'dsp_firmware_version',
  20: 'enable_ac_charge_upper_limit "Enable AC Charge Upper % Limit", gates HR 116 (GivTCP: enable_charge_target / winter mode)',
  21: 'arm_firmware_version',
  22: 'usb_device_inserted',
  23: 'select_arm_chip',
  24: 'variable_address',
  25: 'variable_value',
  26: 'grid_port_max_power_output',
  27: 'eco_mode',
  28: 'enable_60hz_freq_mode',
  29: 'battery_calibration "Battery Calibration" (0=stop; GivTCP: soc_force_adjust)',
  30: 'modbus_address',
  31: 'charge_slot_2_start',
  32: 'charge_slot_2_end',
  33: 'user_code',
  34: 'modbus_version',
  35: 'system_time_year',
  36: 'system_time_month',
  37: 'system_time_day',
  38: 'system_time_hour',
  39: 'system_time_minute',
  40: 'system_time_second',
  41: 'enable_drm_rj45_port',
  42: 'enable_reversed_ct_clamp',
  43: 'charge_soc / discharge_soc (duint8)',
  44: 'discharge_slot_2_start',
  45: 'discharge_slot_2_end',
  46: 'bms_firmware_version',
  47: 'meter_type',
  48: 'enable_reversed_115_meter',
  49: 'enable_reversed_418_meter',
  50: 'active_power_rate',
  51: 'reactive_power_rate',
  52: 'power_factor',
  53: 'enable_inverter_auto_restart / enable_inverter',
  54: 'battery_type (0=lead_acid, 1=lithium)',
  55: 'battery_nominal_capacity',
  56: 'discharge_slot_1_start',
  57: 'discharge_slot_1_end',
  58: 'enable_auto_judge_battery_type',
  59: 'enable_discharge',
  60: 'v_pv_start (deci)',
  61: 'start_countdown_timer',
  62: 'restart_delay_time',
  94: 'charge_slot_1_start',
  95: 'charge_slot_1_end',
  96: 'enable_charge',
  97: 'battery_low_voltage_protection_limit (centi)',
  98: 'battery_high_voltage_protection_limit (centi)',
  104: 'enable_battery_self_heating "Enable Battery Self-Heating"',
  105: 'battery_voltage_adjust (centi)',
  108: 'battery_low_force_charge_time',
  109: 'enable_bms_read',
  110: 'battery_soc_reserve',
  111: 'battery_charge_limit',
  112: 'battery_discharge_limit',
  113: 'enable_buzzer',
  114: 'battery_cutoff_soc "Battery Cutoff % Limit" (percent; GivTCP: battery_discharge_min_power_reserve)',
  116: 'ac_charge_upper_soc "AC Charge Upper % Limit" (percent, enabled by HR 20; GivTCP: charge_target_soc)',
  117: 'charge_soc_stop_2',
  118: 'discharge_soc_stop_2',
  119: 'charge_soc_stop_1',
  120: 'discharge_soc_stop_1',
  121: 'enable_local_command_test',
  122: 'power_factor_function_model',
  123: 'frequency_load_limit_rate',
  124: 'enable_low_voltage_fault_ride_through',
  125: 'enable_frequency_derating',
  126: 'enable_above_6kw_system',
  127: 'start_system_auto_test',
  128: 'enable_spi',
  163: 'inverter_reboot',
  166: 'enable_real_time_control "Real-Time Control" (GivTCP: rtc_enable)',
  167: 'threephase_balance_mode',
  172: 'enable_manual_battery_heater "Enable Manual Battery Heater"',
  175: 'enable_battery_on_pv_or_grid',
  176: 'debug_inverter',
  177: 'enable_ups_mode',
  178: 'enable_g100_limit_switch',
  179: 'enable_battery_cable_impedance_alarm',
  180: 'e_battery_discharge_total_2 (deci)',
  199: 'enable_inverter_parallel_mode "Enable Inverter Parallel Mode", for All in One units in parallel with a Gateway (GivTCP mislabels as enable_standard_self_consumption_logic)',
  // Extended timeslots (Gen 3+)
  242: 'charge_target_soc_1 (gen3)',
  243: 'charge_slot_2_start (gen3)',
  244: 'charge_slot_2_end (gen3)',
  245: 'charge_target_soc_2 (gen3)',
  246: 'charge_slot_3_start',
  247: 'charge_slot_3_end',
  248: 'charge_target_soc_3',
  249: 'charge_slot_4_start',
  250: 'charge_slot_4_end',
  251: 'charge_target_soc_4',
  252: 'charge_slot_5_start',
  253: 'charge_slot_5_end',
  254: 'charge_target_soc_5',
  255: 'charge_slot_6_start',
  256: 'charge_slot_6_end',
  257: 'charge_target_soc_6',
  258: 'charge_slot_7_start',
  259: 'charge_slot_7_end',
  260: 'charge_target_soc_7',
  261: 'charge_slot_8_start',
  262: 'charge_slot_8_end',
  263: 'charge_target_soc_8',
  264: 'charge_slot_9_start',
  265: 'charge_slot_9_end',
  266: 'charge_target_soc_9',
  267: 'charge_slot_10_start',
  268: 'charge_slot_10_end',
  269: 'charge_target_soc_10',
  // Discharge slots 1 and 2 keep their legacy time registers (56/57, 44/45) but take
  // their SOC limits from this block. 273 and 274 are not exposed by the official app.
  272: 'discharge_target_soc_1',
  273: 'unknown (not exposed by official app)',
  274: 'unknown (not exposed by official app)',
  275: 'discharge_target_soc_2',
  276: 'discharge_slot_3_start',
  277: 'discharge_slot_3_end',
  278: 'discharge_target_soc_3',
  279: 'discharge_slot_4_start',
  280: 'discharge_slot_4_end',
  281: 'discharge_target_soc_4',
  282: 'discharge_slot_5_start',
  283: 'discharge_slot_5_end',
  284: 'discharge_target_soc_5',
  285: 'discharge_slot_6_start',
  286: 'discharge_slot_6_end',
  287: 'discharge_target_soc_6',
  288: 'discharge_slot_7_start',
  289: 'discharge_slot_7_end',
  290: 'discharge_target_soc_7',
  291: 'discharge_slot_8_start',
  292: 'discharge_slot_8_end',
  293: 'discharge_target_soc_8',
  294: 'discharge_slot_9_start',
  295: 'discharge_slot_9_end',
  296: 'discharge_target_soc_9',
  297: 'discharge_slot_10_start',
  298: 'discharge_slot_10_end',
  299: 'discharge_target_soc_10',
  311: 'export_power_priority "Export Power Priority" (value meaning unknown)',
  313: 'inverter_charge_power_percentage "Inverter Charge Power Percentage" (GivTCP: battery_charge_limit_ac)',
  314: 'inverter_discharge_power_percentage "Inverter Discharge Power Percentage" (GivTCP: battery_discharge_limit_ac)',
  317: 'enable_eps "Enable EPS"',
  318: 'battery_pause_mode (0=off,1=pause_charge,2=pause_discharge,3=both)',
  319: 'battery_pause_slot_start "Pause Battery Start Time"',
  320: 'battery_pause_slot_end "Pause Battery End Time"',
  331: 'enable_force_off_grid "Force Off Grid"',
  479: 'dc_wind_cvt_voltage "DC Wind CVT Voltage"',
  // Smart Load / Generator (HR 540-573). Shown by the app but not implemented on Gen3:
  // reads of this block time out. Probably for newer models.
  540: 'enable_smart_load "Enable Smart Load"',
  541: 'smart_load_control_soc "Smart Load Control SOC"',
  542: 'enable_general_load "Enable General Load"',
  543: 'general_load_control_soc "General Load Control SOC"',
  544: 'generator_control_soc "Generator Control SOC"',
  545: 'generator_voltage_min "Generator Voltage Min"',
  546: 'generator_voltage_max "Generator Voltage Max"',
  547: 'generator_frequency_min "Generator Frequency Min"',
  548: 'generator_frequency_max "Generator Frequency Max"',
  552: 'smart_load_export_power "Smart Load Export Power"',
  553: 'smart_load_delay_time "Smart Load Delay Time"',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [
    [554 + 2 * i, `smart_load_slot_${i + 1}_start "Smart Load Start Time ${i + 1}"`],
    [555 + 2 * i, `smart_load_slot_${i + 1}_end "Smart Load End Time ${i + 1}"`],
  ]).flat()),
};

function formatTime(val) {
  if (val === 0) return '00:00';
  const h = Math.floor(val / 100);
  const m = val % 100;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatSerial(regs, start, count) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const v = regs.get(start + i) ?? 0;
    s += String.fromCharCode((v >> 8) & 0xFF) + String.fromCharCode(v & 0xFF);
  }
  return s;
}

console.log(`Connecting to ${host}...`);
const inverter = await GivEnergyInverter.connect({ host });

if (debug) {
  inverter.on('debug', (msg) => console.log(`  [debug] ${msg}`));
}

// Access the raw register caches from the poll manager
const pm = inverter.pollManager ?? inverter._pollManager ?? null;
const hrCache = pm?._holdingRegisters;
const irCache = pm?._inputRegisters;

if (!hrCache) {
  console.error('Could not access raw register caches');
  await inverter.stop();
  process.exit(1);
}

// Read holding register blocks the poll manager doesn't read (HR 120-179 and 240-599).
// Blocks an inverter doesn't implement (e.g. HR 540-599 on Gen3) time out; that is
// reported as unsupported rather than treated as a failure.
// We need to trigger reads for these ranges
const { encodeReadHoldingRegistersRequest, encodeReadInputRegistersRequest, encodeReadMeterProductRegistersRequest } = await import('../dist/pdu/encode.js');
const client = pm.client ?? pm._client;
const serial = client?.dataAdapterSerial ?? '**********';

try {
  for (const base of [120, 240, 300, 360, 420, 480, 540]) {
    console.log(`Reading extended HR block ${base}-${base + 59}...`);
    const frame = encodeReadHoldingRegistersRequest({
      dataAdapterSerial: serial,
      slaveAddress: 0x11,
      baseRegister: base,
      registerCount: 60,
    });
    try {
      const values = await client.sendRequest(frame);
      values.forEach((v, i) => hrCache.set(base + i, v));
    } catch (e) {
      // Pushed frames land in hrCache too, so a timed-out block may already be filled.
      const pushed = Array.from({ length: 60 }, (_, i) => hrCache.has(base + i)).every(Boolean);
      if (pushed) {
        console.log(`  (block ${base}-${base + 59} read timed out, but push data filled it)`);
      } else {
        const reason = /timeout/i.test(e.message) ? 'unsupported on this inverter (read timed out)' : e.message;
        console.log(`  (block ${base}-${base + 59} not available: ${reason})`);
      }
    }
  }
} catch (e) {
  console.log(`Could not read extended registers: ${e.message}`);
}

// Read meter registers: scan slaves 0x01-0x08
// Data registers: fc=4 (read input registers), base=60, count=60
// Product registers: fc=22 (read meter product registers), base=60, count=60
const meterDataCaches = new Map();
const meterProductCaches = new Map();
const METER_SLAVES = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];

for (const slave of METER_SLAVES) {
  console.log(`Reading meter data (slave=0x${slave.toString(16).padStart(2, '0')}, fc=4, base=60)...`);
  try {
    const frame = encodeReadInputRegistersRequest({
      dataAdapterSerial: serial,
      slaveAddress: slave,
      baseRegister: 60,
      registerCount: 60,
    });
    const values = await client.sendRequest(frame);
    // Check if valid: v_phase_1 (offset 0 = register 60) should be non-zero
    if (values[0] === 0) {
      console.log(`  Meter 0x${slave.toString(16).padStart(2, '0')}: no data (v_phase_1 = 0), skipping remaining meters`);
      continue;
    }
    const cache = new Map();
    values.forEach((v, i) => cache.set(60 + i, v));
    meterDataCaches.set(slave, cache);
    console.log(`  Meter 0x${slave.toString(16).padStart(2, '0')}: found (${values.length} registers)`);
  } catch (e) {
    console.log(`  Meter 0x${slave.toString(16).padStart(2, '0')}: not responding (${e.message})`);
    continue;
  }

  // Read product info via fc=22 for meters that responded to data read
  console.log(`Reading meter product (slave=0x${slave.toString(16).padStart(2, '0')}, fc=22, base=60)...`);
  try {
    const prodFrame = encodeReadMeterProductRegistersRequest({
      dataAdapterSerial: serial,
      slaveAddress: slave,
      baseRegister: 60,
      registerCount: 60,
    });
    const prodValues = await client.sendRequest(prodFrame);
    const prodCache = new Map();
    prodValues.forEach((v, i) => prodCache.set(60 + i, v));
    meterProductCaches.set(slave, prodCache);
    console.log(`  Meter product 0x${slave.toString(16).padStart(2, '0')}: ok (${prodValues.length} registers)`);
  } catch (e) {
    console.log(`  Meter product 0x${slave.toString(16).padStart(2, '0')}: not available (${e.message})`);
  }
}

await inverter.stop();

// Dump holding registers
console.log('\n=== HOLDING REGISTERS ===\n');

// Collect all register addresses we have data for, plus all named ones
const allAddrs = new Set([...hrCache.keys(), ...Object.keys(REGISTER_NAMES).map(Number)]);
const sorted = [...allAddrs].sort((a, b) => a - b);

for (const addr of sorted) {
  const raw = hrCache.get(addr);
  if (raw === undefined) continue;

  const name = REGISTER_NAMES[addr];
  const hex = `0x${raw.toString(16).padStart(4, '0')}`;

  let extra = '';
  // Format time values for slot registers
  if (name && (name.includes('_start') || name.includes('_end'))) {
    extra = ` → ${formatTime(raw)}`;
  }
  // Format serial strings
  if (addr === 13) {
    extra = ` → "${formatSerial(hrCache, 13, 5)}"`;
  }
  if (addr === 8) {
    extra = ` → "${formatSerial(hrCache, 8, 5)}"`;
  }
  // Format enable/disable
  if (name && name.startsWith('enable_')) {
    extra = ` → ${raw === 1 ? 'ENABLED' : raw === 0 ? 'DISABLED' : `unknown(${raw})`}`;
  }
  if (name && name === 'eco_mode') {
    extra = ` → ${raw === 1 ? 'ENABLED' : raw === 0 ? 'DISABLED' : `unknown(${raw})`}`;
  }

  const label = name ? `  ${name}` : '';
  console.log(`  HR(${String(addr).padStart(3)}) = ${String(raw).padStart(5)}  ${hex}${extra}${label}`);
}

// Also dump input registers for completeness
console.log('\n=== INPUT REGISTERS ===\n');
const irSorted = [...irCache.keys()].sort((a, b) => a - b);
const IR_NAMES = {
  0: 'inverter_status',
  1: 'v_pv1 (deci)',
  2: 'v_pv2 (deci)',
  3: 'v_p_bus',
  4: 'v_n_bus',
  5: 'v_ac1 (deci)',
  6: 'e_battery_throughput_total_h',
  7: 'e_battery_throughput_total_l',
  8: 'i_pv1',
  9: 'i_pv2',
  10: 'i_ac1',
  11: 'e_pv_total_h',
  12: 'e_pv_total_l',
  13: 'f_ac1',
  15: 'v_highbrigh_bus',
  17: 'e_pv1_day (deci)',
  18: 'p_pv1',
  19: 'e_pv2_day (deci)',
  20: 'p_pv2',
  21: 'e_grid_out_total_h',
  22: 'e_grid_out_total_l',
  23: 'e_solar_diverter',
  24: 'p_inverter_out (signed)',
  25: 'e_grid_out_day (deci)',
  26: 'e_grid_in_day (deci)',
  27: 'e_inverter_in_total_h "AC charge" total (IR 27:28)',
  28: 'e_inverter_in_total_l "AC charge" total (IR 27:28)',
  29: 'e_discharge_year',
  30: 'p_grid_out (signed)',
  31: 'p_eps_backup',
  32: 'e_grid_in_total_h',
  33: 'e_grid_in_total_l',
  35: 'e_inverter_in_day (deci) "AC charge" today',
  36: 'e_battery_charge_today (deci)',
  37: 'e_battery_discharge_today (deci)',
  38: 'inverter_countdown',
  41: 'temp_inverter_heatsink (deci)',
  42: 'p_load_demand',
  43: 'p_grid_apparent',
  44: 'e_inverter_out_day (deci)',
  45: 'e_inverter_out_total_h',
  46: 'e_inverter_out_total_l',
  47: 'work_time_total_h',
  48: 'work_time_total_l',
  49: 'system_mode',
  50: 'v_battery (centi)',
  51: 'i_battery (signed, centi)',
  52: 'p_battery (signed)',
  53: 'v_eps_backup (deci)',
  54: 'f_eps_backup (deci)',
  55: 'temp_charger (deci)',
  56: 'temp_battery (deci)',
  58: 'i_grid_port',
  59: 'battery_percent',
  180: 'e_battery_discharge_total_2 (deci)',
  181: 'e_battery_charge_total_2 (deci)',
  182: 'e_battery_discharge_today_2 (deci)',
  183: 'e_battery_charge_today_2 (deci)',
};

for (const addr of irSorted) {
  const raw = irCache.get(addr);
  const name = IR_NAMES[addr];
  const hex = `0x${raw.toString(16).padStart(4, '0')}`;
  const label = name ? `  ${name}` : '';
  console.log(`  IR(${String(addr).padStart(3)}) = ${String(raw).padStart(5)}  ${hex}${label}`);
}

// Dump meter data registers
const METER_DATA_NAMES = {
  60: 'v_phase_1 (deci)',
  61: 'v_phase_2 (deci)',
  62: 'v_phase_3 (deci)',
  63: 'i_phase_1 (centi)',
  64: 'i_phase_2 (centi)',
  65: 'i_phase_3 (centi)',
  66: 'i_ln (centi)',
  67: 'i_total (centi)',
  68: 'p_active_phase_1 (signed)',
  69: 'p_active_phase_2 (signed)',
  70: 'p_active_phase_3 (signed)',
  71: 'p_active_total (signed)',
  72: 'p_reactive_phase_1 (signed)',
  73: 'p_reactive_phase_2 (signed)',
  74: 'p_reactive_phase_3 (signed)',
  75: 'p_reactive_total (signed)',
  76: 'p_apparent_phase_1 (signed)',
  77: 'p_apparent_phase_2 (signed)',
  78: 'p_apparent_phase_3 (signed)',
  79: 'p_apparent_total (signed)',
  80: 'pf_phase_1 (signed, /10000)',
  81: 'pf_phase_2 (signed, /10000)',
  82: 'pf_phase_3 (signed, /10000)',
  83: 'pf_total (signed, /10000)',
  84: 'frequency (centi)',
  85: 'e_import_active (deci)',
  86: 'e_import_reactive (deci)',
  87: 'e_export_active (deci)',
  88: 'e_export_reactive (deci)',
};

for (const [slave, cache] of meterDataCaches) {
  console.log(`\n=== METER 0x${slave.toString(16).padStart(2, '0')} DATA REGISTERS (fc=4) ===\n`);
  const addrs = [...cache.keys()].sort((a, b) => a - b);
  for (const addr of addrs) {
    const raw = cache.get(addr);
    const name = METER_DATA_NAMES[addr];
    const hex = `0x${raw.toString(16).padStart(4, '0')}`;
    const label = name ? `  ${name}` : '';
    console.log(`  IR(${String(addr).padStart(3)}) = ${String(raw).padStart(5)}  ${hex}${label}`);
  }
}

// Dump meter product registers
const METER_PRODUCT_NAMES = {
  60: 'serial_number [60-61]',
  62: 'factory_code [62-63]',
  64: 'meter_type',
  65: 'hardware_version',
  66: 'software_version',
  67: 'modbus_id',
  68: 'baud_rate',
};

for (const [slave, cache] of meterProductCaches) {
  console.log(`\n=== METER 0x${slave.toString(16).padStart(2, '0')} PRODUCT REGISTERS (fc=22) ===\n`);
  const addrs = [...cache.keys()].sort((a, b) => a - b);
  // Show serial and factory code as strings
  if (cache.has(60) && cache.has(61)) {
    console.log(`  Serial:       "${formatSerial(cache, 60, 2)}"`);
  }
  if (cache.has(62) && cache.has(63)) {
    console.log(`  Factory code: "${formatSerial(cache, 62, 2)}"`);
  }
  console.log();
  for (const addr of addrs) {
    const raw = cache.get(addr);
    const name = METER_PRODUCT_NAMES[addr];
    const hex = `0x${raw.toString(16).padStart(4, '0')}`;
    const label = name ? `  ${name}` : '';
    console.log(`  MR(${String(addr).padStart(3)}) = ${String(raw).padStart(5)}  ${hex}${label}`);
  }
}
