#!/usr/bin/env node
/**
 * One-off: builds test/fixtures/gen3-reference.json from a full register scan of the
 * reference Gen3 unit (dumps/2026-11-19-gen3-full-scan.json, which is gitignored).
 *
 * The output keeps the scan's shape but:
 * - drops `host` (a private LAN address);
 * - replaces every serial number with a placeholder;
 * - adds a `source` description.
 *
 * Serials are found at their known registers, then removed from every register map in
 * the file (including any pushed copies), wherever they appear. Any other run of five
 * registers shaped like a GivEnergy serial is replaced too.
 *
 * The real serials are read from the scan at run time and never written here. The script
 * writes nothing and exits non-zero if any form of a real serial survives.
 *
 * Usage: node scripts/make-reference-fixture.mjs [input] [output]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2] ?? 'dumps/2026-11-19-gen3-full-scan.json';
const output = process.argv[3] ?? 'test/fixtures/gen3-reference.json';

const SOURCE = 'reference Gen3 Hybrid 5 kW, ARM/DSP 316, 2026-11-19, serials replaced';
const INVERTER_PLACEHOLDER = 'FD0000A000';
const BATTERY_PLACEHOLDER = 'DZ0000B000';
/** Known serial locations: [register table, first register, placeholder]. */
const KNOWN_SERIALS = [
  ['hr', 13, INVERTER_PLACEHOLDER], // inverter serial, HR 13-17
  ['hr', 8, BATTERY_PLACEHOLDER], // first battery serial, HR 8-12
  ['battery', 110, BATTERY_PLACEHOLDER], // battery module serial, IR 110-114
];
const PLACEHOLDERS = new Set([INVERTER_PLACEHOLDER, BATTERY_PLACEHOLDER]);
/** GivEnergy serial shape: two letters, four digits, a letter, three digits. */
const SERIAL_SHAPE = /^[A-Z]{2}[0-9]{4}[A-Z][0-9]{3}$/;

/** Two ASCII characters per register, high byte first (as src/model/converters.ts). */
const registersToString = (values) =>
  values.map((v) => String.fromCharCode((v >> 8) & 0xff, v & 0xff)).join('');
const stringToRegisters = (text) => {
  const padded = text.padEnd(10, '\0');
  const values = [];
  for (let i = 0; i < padded.length; i += 2) values.push((padded.charCodeAt(i) << 8) | padded.charCodeAt(i + 1));
  return values;
};
const readRun = (table, first, count) => {
  const values = [];
  for (let r = first; r < first + count; r++) {
    if (typeof table[r] !== 'number') return undefined;
    values.push(table[r]);
  }
  return values;
};
const writeRun = (table, first, values) => values.forEach((v, i) => { table[first + i] = v; });
const sameRun = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Every object in the tree whose keys are all register numbers, with its JSON path. */
function registerMaps(node, path = '$', found = []) {
  if (typeof node !== 'object' || node === null) return found;
  const entries = Object.entries(node);
  if (entries.length > 0 && entries.every(([k, v]) => /^\d+$/.test(k) && typeof v === 'number')) {
    found.push([path, node]);
    return found;
  }
  for (const [k, v] of entries) registerMaps(v, `${path}.${k}`, found);
  return found;
}

function fail(message) {
  console.error(`make-reference-fixture: ${message}`);
  process.exit(1);
}

const scan = JSON.parse(readFileSync(input, 'utf8'));
const fixture = structuredClone(scan);
delete fixture.host;

// 1. Read the real serials from their known locations.
const replacements = new Map(); // real serial -> placeholder
for (const [name, first, placeholder] of KNOWN_SERIALS) {
  const values = fixture[name] && readRun(fixture[name], first, 5);
  if (!values) fail(`${name} ${first}-${first + 4} missing from the scan`);
  replacements.set(registersToString(values), placeholder);
}

// 2. Find any other serial-shaped run in any register map.
const maps = registerMaps(fixture);
const extraLocations = [];
for (const [path, table] of maps) {
  for (const key of Object.keys(table)) {
    const values = readRun(table, Number(key), 5);
    const text = values && registersToString(values);
    if (!text || !SERIAL_SHAPE.test(text) || PLACEHOLDERS.has(text) || replacements.has(text)) continue;
    replacements.set(text, BATTERY_PLACEHOLDER);
    extraLocations.push(`${path} ${key}-${Number(key) + 4}`);
  }
}

// 3. Replace every copy of every real serial, in every register map.
const replacedAt = [];
for (const [path, table] of maps) {
  for (const key of Object.keys(table)) {
    const values = readRun(table, Number(key), 5);
    if (!values) continue;
    const placeholder = replacements.get(registersToString(values));
    if (!placeholder) continue;
    writeRun(table, Number(key), stringToRegisters(placeholder));
    replacedAt.push(`${path} ${key}-${Number(key) + 4}`);
  }
}

const { time, ...rest } = fixture;
const outputText = `${JSON.stringify({ time, source: SOURCE, ...rest }, null, 2)}\n`;

// 4. Verify no form of a real serial survives, in the text or as register values.
const leaks = [];
const outputMaps = registerMaps(JSON.parse(outputText));
for (const serial of replacements.keys()) {
  const registers = stringToRegisters(serial);
  const textForms = [serial, serial.slice(-6), Buffer.from(serial, 'latin1').toString('hex'), registers.join(',')];
  textForms.forEach((form, i) => { if (outputText.includes(form)) leaks.push(`text form #${i}`); });
  // The registers of the whole serial, and the three registers holding its last six characters.
  for (const [label, run] of [['full', registers], ['last six', registers.slice(2)]]) {
    for (const [path, table] of outputMaps) {
      for (const key of Object.keys(table)) {
        const found = readRun(table, Number(key), run.length);
        if (found && sameRun(found, run)) leaks.push(`${label} register run at ${path} ${key}`);
      }
    }
  }
}
if (leaks.length > 0) fail(`real serial still present (${leaks.join('; ')}); nothing written`);

writeFileSync(output, outputText);
console.log(`wrote ${output}`);
console.log(`distinct serials replaced: ${replacements.size}`);
console.log(`replaced at: ${replacedAt.join(', ')}`);
console.log(`other serial-shaped runs: ${extraLocations.length ? extraLocations.join(', ') : 'none'}`);
