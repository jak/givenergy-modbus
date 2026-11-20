import { existsSync } from 'fs';
import { parseArgs } from 'util';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('Error: dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

const { GivEnergyInverter, discover } = await import('../dist/index.js');

// Usage: node scripts/monitor.mjs [host] [--port 8899] [--debug]
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

const signed = (watts) => (watts >= 0 ? `+${watts}` : `${watts}`);

// Battery: positive is discharging. Grid: positive is export.
function formatLine(s) {
  const time = new Date().toTimeString().slice(0, 8);
  return `[${time}] solar=${s.solar.power}W  battery=${signed(s.battery.power)}W (${s.battery.stateOfCharge}%)  `
    + `grid=${signed(s.grid.power)}W  load=${s.load.power}W`;
}

console.log(`Connecting to ${host}...`);
const inverter = await GivEnergyInverter.connect({ host, port });

if (debug) {
  inverter.on('debug', (msg) => console.log(`  [debug] ${msg}`));
}

console.log(formatLine(inverter.getData()));

inverter.on('data', (snapshot) => {
  console.log(formatLine(snapshot));
});

inverter.on('lost', (err) => {
  console.error(`Connection lost: ${err.message}`);
});

inverter.on('reconnecting', (attempt, nextRetryMs) => {
  console.log(`Reconnecting... attempt ${attempt}, next retry in ${nextRetryMs}ms`);
});

inverter.on('reconnected', () => {
  console.log('Reconnected to inverter');
});

process.on('SIGINT', async () => {
  console.log('\nStopping...');
  await inverter.stop();
  process.exit(0);
});
