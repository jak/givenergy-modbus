/**
 * Fault and warning bit tables. Every table here is LSB-first: entry i names bit i
 * (value `1 << i`). `null` marks a bit no source names.
 *
 * Sources: the external library britkat1980/givenergy-modbus at a556333
 * (`_inverter_fault_code`, `_charger_warning_code`, `_inverter_fault_code2`), which validated
 * them against the GivEnergy installer app v1.154.3, and research section C. The old GivTCP
 * tables were MSB-first for the 32-bit word and read battery warnings from IR 56 (the battery
 * temperature); neither mistake is copied here.
 */

type BitTable = readonly (string | null)[];

/**
 * Single-phase inverter fault word, HR 223 (high) / HR 224 (low), 32 bits. The external library
 * lists this table MSB-first; it is reversed here so bit 11 is "Hall Sensor Fault".
 */
const INVERTER_FAULTS: BitTable = [
  'Inverter NTC Fault', // 0
  'Grid Frequency Fault',
  'Grid voltage Fault',
  'PV Over voltage',
  'DCI high',
  'Current leak high', // 5
  'PV Isolation Fault',
  'No Utility',
  'Inverter Current Fault',
  'Bus over voltage',
  'DSP Comms Fault', // 10
  'Hall Sensor Fault',
  'GFCI Fault',
  'Inverter Voltage Fault',
  'Relay Fault',
  'Inverter Frequency Fault', // 15
  null, null, null, null, null, null, // 16–21
  'EEPROM Fault', // 22
  'Consistent Fault',
  'ARM Comms Fault',
  'Grid Monitor Comm Fault', // 25
  null, null, // 26–27
  'Backup Overload Fault', // 28
  null, null, null, // 29–31
];

/** Single-phase battery (storage) warning word, IR 57. Bit 11 is reserved. */
const BATTERY_WARNINGS: BitTable = [
  'BMS under-temperature (charge)',
  'BMS under-temperature (discharge)',
  'BMS over-temperature (charge)',
  'BMS over-temperature (discharge)',
  'BMS under-voltage',
  'BMS over-voltage',
  'BMS short-circuit current (discharge)',
  'BMS over-current (discharge)',
  'Charge/discharge module temperature fault',
  'Battery temperature fault',
  'BMS comms fail',
  null,
  'Battery soft-start fail',
  'Battery voltage low',
  'Battery voltage high',
  'Electricity meter comms fail',
];

/** Three-phase fault words IR 1300–1307, one 16-bit table per word. */
const THREE_PHASE_FAULT_WORDS: readonly BitTable[] = [
  [ // IR 1300
    'Battery Voltage High', null, 'Bus 2 Voltage high ISR', 'Bus Voltage high ISR',
    'Inverter OCP fault TZ', 'Frequency unstable', 'Buck Boost Fault ISR', 'BDC OCP Fault',
    'Grid Zero cross loss', null, null, null,
    'Grid Phase 1 voltage fault', 'Grid Phase 2 voltage fault', 'Grid Phase 3 voltage fault', 'Grid frequency out of range',
  ],
  [ // IR 1301
    'Gateway Comm fault', 'GFCI Damage', 'Grid phase 1 voltage low', 'Grid phase 1 voltage high',
    'Grid phase 2 voltage low', 'Grid phase 2 voltage high', 'Grid phase 3 voltage low', 'Grid phase 3 voltage high',
    'Inverter OCP Fault ISR', null, null, null,
    'Inverter Phase 1 Current OCP (RMS)', 'Inverter Phase 2 Current OCP (RMS)', 'Inverter Phase 3 Current OCP (RMS)', 'No Grid connection',
  ],
  [ // IR 1302
    'Grid Frequency Low', 'Grid frequency High', 'Grid voltage imbalance', 'AC PLL fault',
    'Overload fault', 'Backflow timeout', null, 'Grid connected v/f out of range',
    'EPS phase 1 voltage loss', 'EPS phase 2 voltage loss', 'EPS phase 3 voltage loss', 'EPS bus voltage low',
    'EPS overload', 'EPS voltage high', 'DCV high', 'Battery OCP',
  ],
  [ // IR 1303
    'Battery reversed', 'Battery open', 'Battery voltage low', null,
    'Bus2 voltage abnormal', 'Buck boost soft start fail', 'Battery voltage high', null,
    'BMS Error', 'BMS comm fault', null, null,
    null, 'Battery sleep', 'Lead acid NTC open', 'BMS power forbid',
  ],
  [ // IR 1304
    null, null, null, null, null, 'PV1 voltage low', 'PV2 voltage low', null,
    null, null, null, null, null, null, null, null,
  ],
  [ // IR 1305
    'DCI high', 'PV isolation low', 'NTC open', 'Bus voltage high',
    'PV voltage high', 'Boost over temperature', 'Buck Boost over temperature', 'Inverter over temperature',
    'EPS output short circuit', 'Auto test fault', 'Init Model fault', 'Relay fault',
    'Bus voltage unbalance', 'DSP firmware unmatched', 'PV1 short circuit', 'PV2 short circuit',
  ],
  [ // IR 1306
    'PV voltage high', 'External device faulty', 'Acom fault', 'Bcom fault',
    'Master force inverter fault', 'Master force SP fault', 'GFCI High', 'Virtual Load over temp',
    'Internal com fault3', 'Grid consistent', 'EPS connected grid', 'Internal over temperature',
    'Fan fault', 'Hardware unmatch', null, null,
  ],
  [ // IR 1307
    'CT clamp L/N reversed', 'Pairing timeout', 'Meter comms loss', null,
    null, null, 'Battery over temperature', 'Battery over load',
    'Battery full', 'Battery needs Charge', 'BMS Warning', 'Battery weak',
    'Battery low power', 'NTC open', 'Fan warning', null,
  ],
];

function decodeBits(value: number, table: BitTable): string[] {
  const names: string[] = [];
  table.forEach((name, bit) => {
    // Multiply rather than shift: `1 << 31` is negative in JavaScript.
    if (name !== null && Math.floor(value / 2 ** bit) % 2 === 1) names.push(name);
  });
  return names;
}

/** Single-phase inverter faults from HR 223 (high word) and HR 224 (low word). */
export function decodeInverterFaults(high: number | undefined, low: number | undefined): string[] {
  return decodeBits((high ?? 0) * 0x10000 + (low ?? 0), INVERTER_FAULTS);
}

/** Single-phase battery warnings from IR 57. */
export function decodeBatteryWarnings(value: number | undefined): string[] {
  return decodeBits(value ?? 0, BATTERY_WARNINGS);
}

/** Three-phase faults from the words IR 1300–1307, in register order. Unread words count as 0. */
export function decodeThreePhaseFaults(words: readonly (number | undefined)[]): string[] {
  return THREE_PHASE_FAULT_WORDS.flatMap((table, index) => decodeBits(words[index] ?? 0, table));
}
