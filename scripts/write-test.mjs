import { existsSync } from 'fs';
import { createInterface } from 'readline';

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

// A no-op write: ecoMode (HR 27) is written back with the value it already has.
const KEY = 'ecoMode';

function waitForEnter(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

console.log(`Connecting to ${host}...`);
const inverter = await GivEnergyInverter.connect({ host });

if (debug) {
  inverter.on('debug', (msg) => console.log(`  [debug] ${msg}`));
}

const snapshot = inverter.getData();
const current = snapshot.settings[KEY];
console.log(`Connected to ${snapshot.model} ${snapshot.identity.serialNumber}. SoC=${snapshot.battery.stateOfCharge}%`);

if (typeof current !== 'boolean') {
  console.error(`${KEY} was not read from the inverter; not writing anything.`);
  await inverter.stop();
  process.exit(1);
}

// Step 1: confirm before writing anything
await waitForEnter(`\nAbout to write ${KEY} = ${current} (its current value, so nothing changes). Press Enter to write, or Ctrl+C to abort...`);

// Step 2: write it back
await inverter.setSetting(KEY, current);
console.log('Write accepted.');

// Step 3: confirm the snapshot shows it and the connection is still healthy
const final = inverter.getData();
console.log(`\nPost-write ${KEY}=${final.settings[KEY]} SoC=${final.battery.stateOfCharge}% solar=${final.solar.power}W`);

await inverter.stop();
console.log('Write test complete.');
