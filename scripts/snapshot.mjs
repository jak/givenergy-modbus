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

// connect() detects generation and returns the appropriate inverter subclass
const inverter = await GivEnergyInverter.connect({ host });

if (debug) {
  inverter.on('debug', (msg) => console.log(`  [debug] ${msg}`));
}

// connect() waits for the first complete poll, so getData() is immediately available
const s = inverter.getData();

await inverter.stop();

// Generation determines slot counts and available features
const GENERATION_LABELS = {
  gen2: 'Gen2 (single-phase, 1 charge slot / 2 discharge slots)',
  gen3: 'Gen3 (single-phase, 10 charge slots / 10 discharge slots)',
  three_phase: 'Three-phase (2 charge slots / 2 discharge slots)',
};

console.log('\n=== GivEnergy Inverter Snapshot ===');
console.log(`Generation:  ${GENERATION_LABELS[s.generation] ?? s.generation}`);

console.log('\n--- Identity ---');
console.log(`Serial:      ${s.serialNumber}`);
console.log(`Model code:  ${s.modelCode}`);
console.log(`System time: ${s.systemTime.toISOString()}`);

console.log('\n--- Real-time Power ---');
console.log(`Solar:    ${s.solarPower} W`);
console.log(`Battery:  ${s.batteryPower >= 0 ? '+' : ''}${s.batteryPower} W`);
console.log(`Grid:     ${s.gridPower >= 0 ? '+' : ''}${s.gridPower} W`);
console.log(`Load:     ${s.loadPower} W`);

console.log('\n--- Battery ---');
console.log(`SoC:      ${s.stateOfCharge}%`);
console.log(`Voltage:  ${s.batteryVoltage} V`);
console.log(`Current:  ${s.batteryCurrent} A`);

console.log('\n--- Grid ---');
console.log(`Voltage:   ${s.gridVoltage} V`);
console.log(`Frequency: ${s.gridFrequency} Hz`);
console.log(`Temp:      ${s.inverterHeatsinkTemp} °C`);

console.log('\n--- Energy Totals ---');
console.log(`PV generated:       ${s.pvEnergyTotalKwh} kWh`);
console.log(`Battery charged:    ${s.batteryChargeEnergyTotalKwh} kWh`);
console.log(`Battery discharged: ${s.batteryDischargeEnergyTotalKwh} kWh`);
console.log(`Grid import:        ${s.gridImportEnergyTotalKwh} kWh`);
console.log(`Grid export:        ${s.gridExportEnergyTotalKwh} kWh`);

console.log('\n--- Config ---');
console.log(`Enable charge:    ${s.enableCharge}`);
console.log(`Enable discharge: ${s.enableDischarge}`);
console.log(`Charge target:    ${s.chargeTargetStateOfCharge}%`);

console.log('\n--- Charge Slots ---');
for (const [i, slot] of s.chargeSlots.entries()) {
  const target = 'targetStateOfCharge' in slot ? ` → ${slot.targetStateOfCharge}%` : '';
  console.log(`  Slot ${i + 1}: ${slot.start} - ${slot.end}${target}`);
}

console.log('\n--- Discharge Slots ---');
for (const [i, slot] of s.dischargeSlots.entries()) {
  const target = 'targetStateOfCharge' in slot ? ` → ${slot.targetStateOfCharge}%` : '';
  console.log(`  Slot ${i + 1}: ${slot.start} - ${slot.end}${target}`);
}

if (s.batteries.length > 0) {
  console.log('\n--- Batteries ---');
  for (const [i, b] of s.batteries.entries()) {
    console.log(`Battery ${i + 1}: SoC=${b.stateOfCharge}% V=${b.voltage}V serial=${b.serialNumber} cycles=${b.cycleCount}`);
  }
}
