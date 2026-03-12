import { existsSync } from 'fs';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('Error: dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

const { discover, getLocalSubnet, parseSubnet } = await import('../dist/index.js');

const subnet = process.argv[2] ?? getLocalSubnet();
const hosts = parseSubnet(subnet);

console.log(`Scanning ${subnet} (${hosts.length} hosts)...`);

let probed = 0;
const devices = await discover({
  subnet,
  onScanProgress(host, portOpen) {
    probed++;
    if (portOpen) {
      console.log(`  [${probed}/${hosts.length}] ${host} — port open, verifying...`);
    } else {
      process.stdout.write(`\r  [${probed}/${hosts.length}] scanning...`);
    }
  },
  onFound(device) {
    console.log(`  Verified: ${device.host} (${device.serialNumber}, ${device.generation})`);
  },
});

process.stdout.write('\r' + ' '.repeat(40) + '\r'); // clear progress line

if (devices.length === 0) {
  console.error('No GivEnergy inverters found.');
  process.exit(1);
}

for (const device of devices) {
  console.log(`Found: ${device.host} — ${device.serialNumber} (${device.generation}, model 0x${device.modelCode.toString(16).padStart(4, '0')})`);
}
