import { existsSync } from 'fs';
import { parseArgs } from 'util';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('Error: dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

const { GivEnergyInverter, discover } = await import('../dist/index.js');

// Usage: node scripts/identify.mjs [host] [--port 8899]
const { values: flags, positionals } = parseArgs({
  options: { port: { type: 'string' } },
  allowPositionals: true,
});
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

const identity = await GivEnergyInverter.identify({ host, port });

console.log(`\nSerial:      ${identity.serialNumber}`);
console.log(`Model:       ${identity.model}`);
console.log(`Layout:      ${identity.layout}`);
console.log(`Device type: 0x${identity.deviceTypeCode.toString(16).padStart(4, '0')}`);
