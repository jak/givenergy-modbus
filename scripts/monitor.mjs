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

function formatLine(s) {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  const bat = s.batteryPower >= 0 ? `+${s.batteryPower}` : `${s.batteryPower}`;
  const grid = s.gridPower >= 0 ? `+${s.gridPower}` : `${s.gridPower}`;
  return `[${time}] solar=${s.solarPower}W  battery=${bat}W (${s.stateOfCharge}%)  grid=${grid}W  load=${s.loadPower}W`;
}

console.log(`Connecting to ${host}...`);
const inverter = await GivEnergyInverter.connect({ host });

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
