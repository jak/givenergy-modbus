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

// HR(110) = battery_soc_reserve — minimum SOC% the battery won't discharge below
const REGISTER = 110;
const TEST_VALUE = 5;
const RESTORE_VALUE = 4;

function waitForEnter(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

const inverter = new GivEnergyInverter({ host });

if (debug) {
  inverter.on('debug', (msg) => console.log(`  [debug] ${msg}`));
}

console.log(`Connecting to ${host}...`);

const snapshotPromise = new Promise((resolve, reject) => {
  inverter.once('data', resolve);
  inverter.once('lost', reject);
});

await inverter.start();

const snapshot = await snapshotPromise;
console.log(`Connected. SoC=${snapshot.stateOfCharge}%`);

// Step 1: set to test value
console.log(`\nWriting HR(${REGISTER}) = ${TEST_VALUE} (battery_soc_reserve → ${TEST_VALUE}%)...`);
await inverter.writeRegister(REGISTER, TEST_VALUE);
console.log('Write sent.');

// Step 2: pause for manual verification
await waitForEnter(`\nCheck your GivEnergy app/portal to confirm battery SOC reserve is now ${TEST_VALUE}%. Press Enter to restore...`);

// Step 3: restore original value
console.log(`Writing HR(${REGISTER}) = ${RESTORE_VALUE} (restoring battery_soc_reserve → ${RESTORE_VALUE}%)...`);
await inverter.writeRegister(REGISTER, RESTORE_VALUE);
console.log('Write sent.');

// Step 4: confirm connection still healthy
const final = inverter.getData();
console.log(`\nPost-write SoC=${final.stateOfCharge}% solar=${final.solarPower}W`);

await inverter.stop();
console.log('Write test complete.');
