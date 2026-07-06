/**
 * Test script: can we verify an inverter by sending a single read request?
 *
 * Connects to port 8899, sends a read holding registers request with dummy serial,
 * and checks if we get a valid response back.
 */
import { existsSync } from 'fs';

if (!existsSync(new URL('../dist/client.js', import.meta.url))) {
  console.error('Error: dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

const { Client } = await import('../dist/client.js');
const { encodeReadHoldingRegistersRequest } = await import('../dist/pdu/encode.js');

const host = process.argv[2] || '10.29.0.197';
const port = 8899;
const t0 = Date.now();

function elapsed() {
  return ((Date.now() - t0) / 1000).toFixed(1);
}

console.log(`Connecting to ${host}:${port}...`);

const client = new Client({
  host,
  port,
  timeout: 3000,
  retries: 0,
  onDebug: (msg) => console.log(`  [debug +${elapsed()}s] ${msg}`),
});

try {
  await client.connect();
  console.log(`[+${elapsed()}s] TCP connected. Sending read request with dummy serial...`);

  const frame = encodeReadHoldingRegistersRequest({
    dataAdapterSerial: '**********',
    slaveAddress: 0x11,
    baseRegister: 0,
    registerCount: 1,
  });

  const values = await client.sendRequest(frame);
  console.log(`[+${elapsed()}s] SUCCESS — got response with ${values.length} register(s): [${values.join(', ')}]`);
  console.log('This is a real GivEnergy inverter.');
} catch (err) {
  console.log(`[+${elapsed()}s] FAILED — ${err.message}`);
  console.log('This is NOT a GivEnergy inverter (or not reachable).');
} finally {
  await client.close();
  console.log(`[+${elapsed()}s] Done.`);
}
