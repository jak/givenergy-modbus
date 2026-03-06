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

// GivTCP holding register map (from givenergy_modbus_async/model/baseinverter.py)
const REGISTER_NAMES = {
  0: 'device_type_code',
  3: 'num_mppt',
  7: 'enable_ammeter',
  8: 'first_battery_serial [8-12]',
  13: 'serial_number [13-17]',
  18: 'first_battery_bms_firmware_version',
  19: 'dsp_firmware_version',
  20: 'enable_charge_target (winter mode)',
  21: 'arm_firmware_version',
  22: 'usb_device_inserted',
  23: 'select_arm_chip',
  24: 'variable_address',
  25: 'variable_value',
  26: 'grid_port_max_power_output',
  27: 'eco_mode',
  28: 'enable_60hz_freq_mode',
  29: 'soc_force_adjust',
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
  105: 'battery_voltage_adjust (centi)',
  108: 'battery_low_force_charge_time',
  109: 'enable_bms_read',
  110: 'battery_soc_reserve',
  111: 'battery_charge_limit',
  112: 'battery_discharge_limit',
  113: 'enable_buzzer',
  114: 'battery_discharge_min_power_reserve',
  116: 'charge_target_soc',
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
  166: 'rtc_enable',
  167: 'threephase_balance_mode',
  175: 'enable_battery_on_pv_or_grid',
  176: 'debug_inverter',
  177: 'enable_ups_mode',
  178: 'enable_g100_limit_switch',
  179: 'enable_battery_cable_impedance_alarm',
  180: 'e_battery_discharge_total_2 (deci)',
  199: 'enable_standard_self_consumption_logic',
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
  272: 'discharge_slot_1_start (gen3)',
  273: 'discharge_slot_1_end (gen3)',
  274: 'discharge_target_soc_1',
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
  313: 'battery_charge_limit_ac',
  314: 'battery_discharge_limit_ac',
  318: 'battery_pause_mode (0=off,1=pause_charge,2=pause_discharge,3=both)',
  319: 'battery_pause_slot_1_start',
  320: 'battery_pause_slot_1_end',
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

const inverter = new GivEnergyInverter({ host });

if (debug) {
  inverter.on('debug', (msg) => console.log(`  [debug] ${msg}`));
}

const snapshotPromise = new Promise((resolve, reject) => {
  inverter.once('data', resolve);
  inverter.once('lost', reject);
});

console.log(`Connecting to ${host}...`);
await inverter.start();
await snapshotPromise;

// Access the raw register caches from the poll manager
const pm = inverter.pollManager ?? inverter._pollManager ?? null;
const hrCache = pm?._holdingRegisters;
const irCache = pm?._inputRegisters;

if (!hrCache) {
  console.error('Could not access raw register caches');
  await inverter.stop();
  process.exit(1);
}

// Read extended register blocks (240-299, 300-359) that the poll manager doesn't read
// We need to trigger reads for these ranges
try {
  const { encodeReadHoldingRegistersRequest } = await import('../dist/pdu/encode.js');
  const client = pm.client ?? pm._client;
  const serial = client?.dataAdapterSerial ?? '**********';

  for (const base of [240, 300, 360, 420, 480]) {
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
      console.log(`  (block ${base} not available: ${e.message})`);
    }
  }
} catch (e) {
  console.log(`Could not read extended registers: ${e.message}`);
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
  5: 'v_ac1 (deci)',
  9: 'f_ac1',
  11: 'e_pv_total_h',
  12: 'e_pv_total_l',
  13: 'f_ac1 (alt)',
  18: 'p_pv1',
  20: 'p_pv2',
  21: 'e_grid_out_total_h',
  22: 'e_grid_out_total_l',
  27: 'e_inverter_in_total_h',
  28: 'e_inverter_in_total_l',
  29: 'e_discharge_year',
  30: 'p_grid_out (signed)',
  32: 'e_grid_in_total_h',
  33: 'e_grid_in_total_l',
  41: 'temp_inverter_heatsink (deci)',
  42: 'p_load_demand',
  50: 'v_battery (centi)',
  51: 'i_battery (signed, centi)',
  52: 'p_battery (signed)',
  59: 'battery_percent',
  181: 'e_battery_charge_total_2 (deci)',
};

for (const addr of irSorted) {
  const raw = irCache.get(addr);
  const name = IR_NAMES[addr];
  const hex = `0x${raw.toString(16).padStart(4, '0')}`;
  const label = name ? `  ${name}` : '';
  console.log(`  IR(${String(addr).padStart(3)}) = ${String(raw).padStart(5)}  ${hex}${label}`);
}
