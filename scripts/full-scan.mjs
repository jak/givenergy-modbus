// Read-only full register scan, written to a JSON file.
//
// Reads HR 0-599 and IR 0-299 from the inverter (slave 0x11) in 60-register blocks,
// plus the first battery BMS (slave 0x32, IR 60-119). Nothing is written to the device.
//
// Usage: node scripts/full-scan.mjs [host] [out.json]
//
// The output contains inverter and battery serial numbers. The default output path is
// under dumps/, which is gitignored; keep scans out of git.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('Error: dist/index.js not found. Run `npm run build` first.');
  process.exit(1);
}

const { GivEnergyInverter, discover } = await import('../dist/index.js');
const { encodeReadHoldingRegistersRequest, encodeReadInputRegistersRequest } = await import('../dist/pdu/encode.js');

let [host, out] = process.argv.slice(2);

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

const time = new Date().toISOString();
out ??= `dumps/${time.slice(0, 10)}-full-scan.json`;

const inverter = await GivEnergyInverter.connect({ host });
const pm = inverter.pollManager ?? inverter._pollManager;
const client = pm.client ?? pm._client;
const serial = client.dataAdapterSerial;

// Quirk: inverters in "push mode" send register blocks unsolicited, and an explicit read
// can time out even though its registers have already arrived that way. The poll manager
// caches every pushed frame from the inverter (slave 0x11), so a timed-out inverter block
// is only classed as unsupported if those caches don't hold it either.
//
// `pushed` lists blocks filled from push data after their read timed out. `unsupported`
// lists blocks that timed out with no push data: the inverter doesn't implement them
// (e.g. HR 540-599, Smart Load / Generator, on Gen3). `errors` lists any other failure.
const result = { time, host, hr: {}, ir: {}, battery: {}, pushed: [], unsupported: [], errors: [] };
const timedOut = [];

async function read(kind, slave, base, count, target) {
  const encode = kind === 'hr' ? encodeReadHoldingRegistersRequest : encodeReadInputRegistersRequest;
  const label = `${kind} slave=0x${slave.toString(16)} ${base}-${base + count - 1}`;
  try {
    const values = await client.sendRequest(encode({ dataAdapterSerial: serial, slaveAddress: slave, baseRegister: base, registerCount: count }));
    values.forEach((v, i) => { target[base + i] = v; });
    console.log(`${label}: ok`);
  } catch (e) {
    if (/timeout/i.test(e.message)) {
      timedOut.push({ kind, slave, base, count, target, label });
      console.log(`${label}: read timed out`);
    } else {
      result.errors.push(`${label}: ${e.message}`);
      console.log(`${label}: ${e.message}`);
    }
  }
}

try {
  for (let base = 0; base < 600; base += 60) await read('hr', 0x11, base, 60, result.hr);
  for (let base = 0; base < 300; base += 60) await read('ir', 0x11, base, 60, result.ir);
  await read('ir', 0x32, 60, 60, result.battery);

  // Classify timed-out blocks now that all push data received during the scan is cached.
  for (const { kind, slave, base, count, target, label } of timedOut) {
    const cache = slave === 0x11 ? (kind === 'hr' ? pm._holdingRegisters : pm._inputRegisters) : undefined;
    const values = Array.from({ length: count }, (_, i) => cache?.get(base + i));
    if (values.every(v => v !== undefined)) {
      values.forEach((v, i) => { target[base + i] = v; });
      result.pushed.push(label);
      console.log(`${label}: filled from push data`);
    } else {
      result.unsupported.push(label);
      console.log(`${label}: unsupported on this inverter (timed out, no push data)`);
    }
  }
} finally {
  await inverter.stop();
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`Wrote ${out}`);
