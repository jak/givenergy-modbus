// Interactive console for trying the library against a real inverter.
//
// Usage: node scripts/try.mjs [host] [--port 8899] [--read-only] [--debug]
//
// Shows a live status panel and lets you edit charge/discharge slots, the battery pause and
// any safe catalogue setting. Every write shows the current and new value and needs `y`.
// `undo` puts back everything this session changed. Writes are logged to dumps/ (gitignored).
// Unsafe settings (unsafe_setSetting) and raw register writes are deliberately not offered.
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { parseArgs } from 'util';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('Error: dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

const { GivEnergyInverter, SETTINGS, discover } = await import('../dist/index.js');

const { values: flags, positionals } = parseArgs({
  options: {
    port: { type: 'string' },
    'read-only': { type: 'boolean' },
    debug: { type: 'boolean' },
  },
  allowPositionals: true,
});
const readOnly = flags['read-only'] ?? false;
const port = flags.port === undefined ? undefined : Number(flags.port);
const interactive = process.stdout.isTTY === true;

// ── Session log (dumps/ is gitignored) ───────────────────────────────────────
const dumpsDir = new URL('../dumps/', import.meta.url);
mkdirSync(dumpsDir, { recursive: true });
const logFile = new URL(`try-${new Date().toISOString().replace(/[:.]/g, '-')}.log`, dumpsDir);
function log(event, details = {}) {
  appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n');
}

// ── Connect ──────────────────────────────────────────────────────────────────
let host = positionals[0];
if (!host) {
  console.log('No host specified, auto-discovering...');
  const devices = await discover();
  if (devices.length === 0) {
    console.error('No GivEnergy inverters found. Provide a host as the first argument.');
    process.exit(1);
  }
  host = devices[0].host;
  console.log(`Found ${devices.length} device(s); using ${host}`);
}

console.log(`Connecting to ${host}... (the first snapshot takes 10-30 s)`);
const started = Date.now();
const inverter = await GivEnergyInverter.connect({ host, port });
log('connected', { host, seconds: (Date.now() - started) / 1000, model: inverter.getData().model });

const events = []; // recent connection events, shown under the panel
function note(message) {
  events.push(`${new Date().toLocaleTimeString()} ${message}`);
  if (events.length > 5) events.shift();
  log('event', { message });
}
note(`connected in ${((Date.now() - started) / 1000).toFixed(1)} s`);
inverter.on('lost', (error) => { note(`connection lost: ${error.message}`); redraw(); });
inverter.on('reconnecting', (attempt, ms) => { note(`reconnecting (attempt ${attempt}, next in ${ms} ms)`); redraw(); });
inverter.on('reconnected', () => { note('reconnected'); redraw(); });
if (flags.debug) inverter.on('debug', (message) => log('debug', { message }));

let lastData = Date.now();
let dataCount = 0;
inverter.on('data', () => { lastData = Date.now(); dataCount++; redraw(); });

// ── Formatting ───────────────────────────────────────────────────────────────
const bold = (s) => (interactive ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s) => (interactive ? `\x1b[2m${s}\x1b[0m` : s);
const watts = (w) => (typeof w === 'number' ? `${Math.round(w)} W` : '—');
const show = (v) => (v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function slotText(slot) {
  if (!slot) return '—';
  const target = slot.targetStateOfCharge === undefined ? '' : ` → ${slot.targetStateOfCharge}%`;
  const empty = slot.start === '00:00' && slot.end === '00:00';
  return `${slot.start}–${slot.end}${target}${empty ? dim(' (empty)') : ''}`;
}

function panel() {
  const s = inverter.getData();
  const lines = [];
  const age = Math.round((Date.now() - lastData) / 1000);
  lines.push(bold(`GivEnergy ${s.model} (${s.layout})`) + `   firmware ARM ${show(s.identity.firmware?.arm)} DSP ${show(s.identity.firmware?.dsp)}`);
  lines.push(dim(`host ${host}   data updates ${dataCount}, last ${age} s ago   inverter clock ${s.status.systemTime?.toLocaleString() ?? '—'}${readOnly ? '   READ-ONLY' : ''}`));
  lines.push('');
  lines.push(bold('Power'));
  lines.push(`  solar ${watts(s.solar.power)}   battery ${watts(s.battery.power)} ${dim('(+ discharge)')}   grid ${watts(s.grid.power)} ${dim('(+ export)')}   load ${watts(s.load.power)}`);
  lines.push(`  battery ${show(s.battery.stateOfCharge)}%  ${show(s.battery.voltage)} V   status ${show(s.status.inverterStatus)}`);
  const flows = Object.entries(s.powerFlows ?? {}).filter(([, w]) => w > 0).map(([k, w]) => `${k} ${watts(w)}`);
  lines.push(`  flows ${flows.length ? flows.join(', ') : 'none'}`);
  if (s.meters?.length) lines.push(`  meters ${s.meters.map((m) => `#${m.slaveAddress} ${watts(m.activePowerTotal)}`).join('  ')}`);
  lines.push('');
  lines.push(bold('Schedules'));
  const charge = s.schedules.charge ?? [];
  const discharge = s.schedules.discharge ?? [];
  const rows = Math.max(charge.length, discharge.length);
  for (let i = 0; i < rows; i++) {
    lines.push(`  ${String(i + 1).padStart(2)}  charge ${slotText(charge[i]).padEnd(30)} discharge ${slotText(discharge[i])}`);
  }
  if (s.schedules.batteryPause) {
    const p = s.schedules.batteryPause;
    lines.push(`  battery pause ${p.mode}${p.start ? ` ${p.start}–${p.end}` : ''}`);
  }
  lines.push('');
  lines.push(bold('Key settings'));
  const keys = ['ecoMode', 'acCharge', 'dcDischarge', 'batteryReserve', 'batteryChargeRate', 'batteryDischargeRate', 'acChargeUpperLimit', 'exportPriority'];
  const shown = keys.filter((k) => s.settings[k] !== undefined).map((k) => `${k}=${show(s.settings[k])}`);
  for (let i = 0; i < shown.length; i += 4) lines.push('  ' + shown.slice(i, i + 4).join('   '));
  lines.push('');
  if (events.length) lines.push(dim(events.join('\n')), '');
  if (changes.size) lines.push(`${changes.size} change(s) this session; "undo" puts them back.`);
  lines.push(dim(readOnly
    ? 'commands: settings, refresh, log, quit'
    : 'commands: charge <n>, discharge <n>, pause, set <key> <value>, settings, sync-clock, undo, refresh, log, quit'));
  return lines.join('\n');
}

// ── Input ────────────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
let busy = false; // true while asking a multi-step question, so redraws don't clobber it

function redraw() {
  if (busy || !interactive) return;
  process.stdout.write('\x1b[2J\x1b[H' + panel() + '\n');
  rl.prompt(true);
}

function ask(question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function confirm(what) {
  const answer = await ask(`${what}\nWrite this to the inverter? Type y to confirm: `);
  return answer.toLowerCase() === 'y';
}

// ── Undo ─────────────────────────────────────────────────────────────────────
// The first value seen for each thing changed in this session, keyed so a second edit to the
// same slot or setting keeps the original.
const changes = new Map();
function remember(key, restore, description) {
  if (!changes.has(key)) changes.set(key, { restore, description });
}

async function write(label, details, action) {
  log('write-attempt', { label, ...details });
  try {
    await action();
    log('write-ok', { label });
    note(`wrote ${label}`);
    return true;
  } catch (error) {
    log('write-failed', { label, error: error.message });
    console.log(`Write failed: ${error.name}: ${error.message}`);
    note(`write failed: ${label}`);
    return false;
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function editSlot(kind, argument) {
  const s = inverter.getData();
  const slots = s.schedules[kind] ?? [];
  const number = Number(argument);
  const current = slots.find((slot) => slot.slot === number);
  if (!current) {
    console.log(`Slot must be one of ${slots.map((slot) => slot.slot).join(', ')}.`);
    return;
  }
  console.log(`${kind} slot ${number} is ${slotText(current)}. Enter "clear" for 00:00–00:00.`);
  let start = await ask(`start HH:MM [${current.start}]: `);
  let end;
  if (start === 'clear') {
    start = '00:00';
    end = '00:00';
  } else {
    start ||= current.start;
    end = (await ask(`end HH:MM [${current.end}]: `)) || current.end;
  }
  if (!TIME.test(start) || !TIME.test(end)) { console.log('Times must be HH:MM, 24-hour.'); return; }
  const next = { start, end };
  if (current.targetStateOfCharge !== undefined) {
    const target = (await ask(`target state of charge % [${current.targetStateOfCharge}]: `)) || String(current.targetStateOfCharge);
    next.targetStateOfCharge = Number(target);
  }
  if (!(await confirm(`${kind} slot ${number}: ${slotText(current)}  →  ${slotText({ ...next, slot: number })}`))) return;
  const original = { start: current.start, end: current.end, ...(current.targetStateOfCharge === undefined ? {} : { targetStateOfCharge: current.targetStateOfCharge }) };
  const setter = kind === 'charge' ? (n, c) => inverter.setChargeSlot(n, c) : (n, c) => inverter.setDischargeSlot(n, c);
  if (await write(`${kind} slot ${number}`, { from: original, to: next }, () => setter(number, next))) {
    remember(`${kind}:${number}`, () => setter(number, original), `${kind} slot ${number} → ${slotText({ ...original, slot: number })}`);
  }
}

async function editPause() {
  if (inverter.layout !== 'single_phase' || !inverter.capabilities.pauseMode) {
    console.log('This inverter has no battery pause.');
    return;
  }
  const current = inverter.getData().schedules.batteryPause;
  console.log(`battery pause is ${current?.mode ?? '—'}${current?.start ? ` ${current.start}–${current.end}` : ''}`);
  const mode = (await ask(`mode off|charge|discharge|both [${current?.mode}]: `)) || current?.mode;
  if (!['off', 'charge', 'discharge', 'both'].includes(mode)) { console.log('Unknown mode.'); return; }
  const next = { mode };
  if (inverter.capabilities.pauseWindow) {
    const start = (await ask(`start HH:MM [${current?.start ?? ''}] (blank keeps it): `)) || current?.start;
    const end = (await ask(`end HH:MM [${current?.end ?? ''}] (blank keeps it): `)) || current?.end;
    if (start !== undefined && end !== undefined) {
      if (!TIME.test(start) || !TIME.test(end)) { console.log('Times must be HH:MM, 24-hour.'); return; }
      next.start = start;
      next.end = end;
    }
  }
  const text = (p) => `${p.mode}${p.start ? ` ${p.start}–${p.end}` : ''}`;
  if (!(await confirm(`battery pause: ${current ? text(current) : '—'}  →  ${text(next)}`))) return;
  const original = current && current.mode !== 'unknown'
    ? { mode: current.mode, ...(current.start ? { start: current.start, end: current.end } : {}) }
    : undefined;
  if (await write('battery pause', { from: original, to: next }, () => inverter.setBatteryPause(next))) {
    if (original) remember('pause', () => inverter.setBatteryPause(original), `battery pause → ${text(original)}`);
    else console.log('The old mode read as unknown, so undo cannot restore it.');
  }
}

function writableSettings() {
  return Object.entries(SETTINGS).filter(([key, def]) => def.writable !== false && !def.unsafe && inverter.supports(key));
}

function describe(def) {
  switch (def.kind) {
    case 'boolean': return 'on|off';
    case 'percent': return `${def.min}–${def.max} %`;
    case 'integer': return `${def.min}–${def.max}${def.unit ? ` ${def.unit}` : ''}`;
    case 'enum': return (def.writableValues ?? Object.keys(def.values)).join('|');
    case 'time': return 'HH:MM';
    default: return def.kind;
  }
}

function parseValue(def, text) {
  switch (def.kind) {
    case 'boolean':
      if (/^(on|true|1|yes)$/i.test(text)) return true;
      if (/^(off|false|0|no)$/i.test(text)) return false;
      throw new RangeError('expected on or off');
    case 'percent':
    case 'integer': {
      const n = Number(text);
      if (text === '' || Number.isNaN(n)) throw new RangeError('expected a number');
      return n;
    }
    default:
      return text;
  }
}

function listSettings() {
  const s = inverter.getData();
  for (const [key, def] of Object.entries(SETTINGS)) {
    if (!inverter.supports(key)) continue;
    const access = def.unsafe ? 'unsafe, not offered' : def.writable === false ? 'read-only' : describe(def);
    console.log(`  ${key.padEnd(32)} ${show(s.settings[key]).padEnd(10)} ${dim(access)}`);
  }
}

async function setSetting(key, valueText) {
  const def = SETTINGS[key];
  if (!def) { console.log(`Unknown setting "${key}". Type "settings" for the list.`); return; }
  if (!writableSettings().some(([k]) => k === key)) { console.log(`${key} is not writable here (read-only, unsafe, or unsupported).`); return; }
  let value;
  try { value = parseValue(def, valueText ?? ''); } catch (error) { console.log(`${error.message} (${describe(def)})`); return; }
  const current = inverter.getData().settings[key];
  if (!(await confirm(`${key}: ${show(current)}  →  ${show(value)}`))) return;
  if (await write(key, { from: current, to: value }, () => inverter.setSetting(key, value))) {
    if (current === undefined || current === 'unknown') console.log('The old value was not known, so undo cannot restore it.');
    else remember(`setting:${key}`, () => inverter.setSetting(key, current), `${key} → ${show(current)}`);
  }
}

async function syncClock() {
  const clock = inverter.getData().status.systemTime;
  if (!(await confirm(`inverter clock: ${clock?.toLocaleString() ?? '—'}  →  ${new Date().toLocaleString()} (no undo)`))) return;
  await write('clock', { from: clock?.toISOString() }, () => inverter.syncDateTime());
}

async function undo() {
  if (changes.size === 0) { console.log('Nothing to undo.'); return; }
  const entries = [...changes.entries()].reverse();
  console.log(entries.map(([, c]) => `  ${c.description}`).join('\n'));
  if (!(await confirm(`Put back these ${entries.length} change(s)?`))) return;
  for (const [key, change] of entries) {
    if (await write(`undo ${change.description}`, {}, change.restore)) changes.delete(key);
  }
}

const WRITES = new Set(['charge', 'discharge', 'pause', 'set', 'sync-clock', 'undo']);

async function run(line) {
  const [command, ...rest] = line.trim().split(/\s+/);
  if (!command) return;
  if (readOnly && WRITES.has(command)) { console.log('Read-only mode: writes are off.'); return; }
  switch (command) {
    case 'charge':
    case 'discharge': return editSlot(command, rest[0]);
    case 'pause': return editPause();
    case 'set': return setSetting(rest[0], rest.slice(1).join(' '));
    case 'settings': return listSettings();
    case 'sync-clock': return syncClock();
    case 'undo': return undo();
    case 'log': console.log(`Session log: ${logFile.pathname}`); return;
    case 'refresh':
    case 'r': if (!interactive) console.log(panel()); return;
    case 'quit':
    case 'q': return quit();
    default: console.log(`Unknown command "${command}".`);
  }
}

let quitting = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  busy = true;
  if (changes.size && !inputClosed) {
    const answer = await ask(`${changes.size} change(s) not undone. Undo before quitting? [y/N] `);
    if (answer.toLowerCase() === 'y') {
      for (const [key, change] of [...changes.entries()].reverse()) {
        if (await write(`undo ${change.description}`, {}, change.restore)) changes.delete(key);
      }
    }
  }
  if (changes.size) console.log(`${changes.size} change(s) left in place; see the session log.`);
  rl.close();
  await inverter.stop();
  log('stopped');
  console.log(`Stopped. Session log: ${logFile.pathname}`);
  process.exit(0);
}

// Lines run one at a time, in order; answers to ask() go to its callback instead.
let queue = Promise.resolve();
let inputClosed = false;
async function handle(line) {
  busy = true;
  try {
    await run(line);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  if (quitting) return;
  if (interactive && !inputClosed) await ask(dim('press Enter to continue'));
  busy = false;
  if (interactive) redraw();
  else rl.prompt();
}
rl.on('line', (line) => { queue = queue.then(() => handle(line)); });
rl.on('close', () => { inputClosed = true; queue = queue.then(() => quit()); });

if (interactive) redraw();
else { console.log(panel()); rl.prompt(); }
