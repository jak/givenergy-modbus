import { existsSync } from 'fs';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('Error: dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

const { GivEnergyInverter, discover } = await import('../dist/index.js');

let host = process.argv[2];

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

const identity = await GivEnergyInverter.identify({ host });

console.log(`\nSerial:     ${identity.serialNumber}`);
console.log(`Generation: ${identity.generation}`);
console.log(`Model code: 0x${identity.modelCode.toString(16).padStart(4, '0')}`);
