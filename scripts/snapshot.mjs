import { existsSync } from 'fs';
import { parseArgs } from 'util';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('Error: dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

const { GivEnergyInverter, SETTINGS, discover } = await import('../dist/index.js');

// Usage: node scripts/snapshot.mjs [host] [--port 8899] [--debug]
const { values: flags, positionals } = parseArgs({
  options: { port: { type: 'string' }, debug: { type: 'boolean' } },
  allowPositionals: true,
});
const debug = flags.debug ?? false;
const port = flags.port === undefined ? undefined : Number(flags.port);
let host = positionals[0];

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

// connect() resolves the model and returns a SinglePhaseInverter or ThreePhaseInverter.
const inverter = await GivEnergyInverter.connect({ host, port });
if (debug) inverter.on('debug', (msg) => console.log(`  [debug] ${msg}`));

// connect() waits for the first complete poll, so getData() is immediately available.
const s = inverter.getData();
await inverter.stop();

// ── Formatting ───────────────────────────────────────────────────────────────
// The groups are walked generically so new snapshot fields show up without editing this
// script. Units are inferred from field names.

const UNIT_RULES = [
  [/Kwh$/, 'kWh'],
  [/Kvarh$/, 'kvarh'],
  [/Ah$/, 'Ah'],
  [/Seconds$/, 's'],
  [/apparentPower(Total)?$/i, 'VA'],
  [/reactivePower(Total)?$/i, 'var'],
  [/powerFactor/i, ''],
  [/(^|[a-z])(p|P)ower(Total)?$|ratedPower$|MaxPower$/, 'W'],
  [/^solarTo|^batteryTo|^gridTo/, 'W'],
  [/[vV]oltages?(Total)?$|[vV]oltage(Min|Max)$/, 'V'],
  [/[cC]urrent(Total)?$/, 'A'],
  [/[fF]requency$/, 'Hz'],
  [/[tT]emperatures?(Min|Max)?$/, '°C'],
  [/stateOfCharge(Max|Min)?$|Percent$/, '%'],
  [/^hoursOfOperation$/, 'h'],
];

function unitFor(key) {
  for (const [pattern, unit] of UNIT_RULES) if (pattern.test(key)) return unit;
  return '';
}

function formatValue(value, unit = '') {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(v)).join(', ')}]${unit ? ` ${unit}` : ''}`;
  if (typeof value === 'string') return value === '' ? '""' : value;
  return `${value}${unit ? ` ${unit}` : ''}`;
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

function walk(value, indent = '  ') {
  for (const [key, field] of Object.entries(value)) {
    if (isPlainObject(field)) {
      console.log(`${indent}${key}:`);
      walk(field, `${indent}  `);
    } else if (Array.isArray(field) && field.some(isPlainObject)) {
      console.log(`${indent}${key}:${field.length === 0 ? ' (none)' : ''}`);
      field.forEach((item, i) => {
        console.log(`${indent}  [${i}]`);
        walk(item, `${indent}    `);
      });
    } else if (key === 'deviceTypeCode') {
      console.log(`${indent}${key}: 0x${field.toString(16).padStart(4, '0')}`);
    } else {
      console.log(`${indent}${key}: ${formatValue(field, unitFor(key))}`);
    }
  }
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

// ── Header ───────────────────────────────────────────────────────────────────

console.log('\n=== GivEnergy Inverter Snapshot ===');
console.log(`Model:        ${s.model} (${s.layout})`);
console.log(`Serial:       ${s.identity.serialNumber}`);
console.log(`Device type:  0x${s.identity.deviceTypeCode.toString(16).padStart(4, '0')}`);
console.log(`Firmware:     ${Object.entries(s.identity.firmware).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`Capabilities: ${Object.entries(s.capabilities).map(([k, v]) => `${k}=${v}`).join(' ')}`);

// ── Groups ───────────────────────────────────────────────────────────────────

const HEADER_KEYS = new Set(['layout', 'model', 'capabilities']);
const SPECIAL_KEYS = new Set(['battery', 'meters', 'settings', 'schedules', 'powerFlows']);

for (const [group, value] of Object.entries(s)) {
  if (HEADER_KEYS.has(group) || SPECIAL_KEYS.has(group)) continue;
  section(group);
  walk(value);
}

// Battery: the battery's own fields, then its modules and stacks.
section('battery');
const { modules, stacks, ...battery } = s.battery;
walk(battery);
console.log(`  modules:${modules.length === 0 ? ' (none)' : ''}`);
modules.forEach((module, i) => {
  console.log(`    [${i}] ${module.kind} ${module.serialNumber}`);
  walk(module, '      ');
});
if (stacks !== undefined) {
  console.log(`  stacks:${stacks.length === 0 ? ' (none)' : ''}`);
  stacks.forEach((stack, i) => {
    console.log(`    [${i}]`);
    walk(stack, '      ');
  });
}

section(`meters (${s.meters.length})`);
s.meters.forEach((meter, i) => {
  console.log(`  [${i}] slave 0x${meter.slaveAddress.toString(16).padStart(2, '0')}`);
  walk(meter, '    ');
});

section('powerFlows');
walk(s.powerFlows);

// ── Settings, from the catalogue ─────────────────────────────────────────────

section('settings');
const registerOn = (definition) => (typeof definition.register === 'number'
  ? (!definition.layouts || definition.layouts.includes(s.layout) ? definition.register : undefined)
  : definition.register[s.layout]);
const notSupported = [];
const notRead = [];
for (const [key, definition] of Object.entries(SETTINGS)) {
  const register = registerOn(definition);
  if (register === undefined) continue; // not on this layout
  const supported = definition.supported ? definition.supported(s.capabilities, s.layout) : true;
  if (!supported) { notSupported.push(`${key} (HR ${register})`); continue; }
  if (!(key in s.settings)) { notRead.push(`${key} (HR ${register})`); continue; }
  const unit = definition.unit ?? (definition.kind === 'percent' ? '%' : '');
  const marks = [definition.unsafe ? 'UNSAFE' : '', definition.writable === false ? 'read only' : ''].filter(Boolean);
  const label = definition.appName ? `${definition.appName} (${key})` : key;
  console.log(`  HR ${String(register).padEnd(4)} ${label}: ${formatValue(s.settings[key], unit)}${marks.length ? `  [${marks.join(', ')}]` : ''}`);
}
if (notSupported.length > 0) console.log(`  Not supported on this model: ${notSupported.join(', ')}`);
if (notRead.length > 0) console.log(`  Supported but not read (block unanswered?): ${notRead.join(', ')}`);

// ── Schedules ────────────────────────────────────────────────────────────────

section('schedules');
for (const kind of ['charge', 'discharge']) {
  console.log(`  ${kind}:${s.schedules[kind].length === 0 ? ' (none read)' : ''}`);
  for (const slot of s.schedules[kind]) {
    const target = slot.targetStateOfCharge !== undefined ? ` → ${slot.targetStateOfCharge}%` : '';
    console.log(`    Slot ${String(slot.slot).padStart(2)}: ${slot.start} - ${slot.end}${target}`);
  }
}
if ('batteryPause' in s.schedules) {
  const pause = s.schedules.batteryPause;
  const window = pause.start !== undefined ? ` (${pause.start} - ${pause.end})` : '';
  console.log(`  battery pause: ${pause.mode}${window}`);
}
