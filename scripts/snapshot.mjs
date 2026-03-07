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
console.log(`Solar:    ${s.solarPower} W (PV1: ${s.pvString1Power} W, PV2: ${s.pvString2Power} W)`);
console.log(`Battery:  ${s.batteryPower >= 0 ? '+' : ''}${s.batteryPower} W (${s.batteryPower > 0 ? 'discharging' : s.batteryPower < 0 ? 'charging' : 'idle'})`);
console.log(`Grid:     ${s.gridPower >= 0 ? '+' : ''}${s.gridPower} W (${s.gridPower > 0 ? 'exporting' : s.gridPower < 0 ? 'importing' : 'idle'})`);
console.log(`Load:     ${s.loadPower} W`);
console.log(`Inverter: ${s.inverterOutputPower} W`);
console.log(`Grid apparent: ${s.gridApparentPower} VA`);
if (s.epsBackupPower > 0) console.log(`EPS:      ${s.epsBackupPower} W`);

console.log('\n--- PV Strings ---');
console.log(`String 1: ${s.pvString1Voltage} V / ${s.pvString1Current} A / ${s.pvString1Power} W`);
console.log(`String 2: ${s.pvString2Voltage} V / ${s.pvString2Current} A / ${s.pvString2Power} W`);

console.log('\n--- Battery ---');
console.log(`SoC:      ${s.stateOfCharge}%`);
console.log(`Voltage:  ${s.batteryVoltage} V`);
console.log(`Current:  ${s.batteryCurrent} A`);

console.log('\n--- Grid ---');
console.log(`Voltage:   ${s.gridVoltage} V`);
console.log(`Frequency: ${s.gridFrequency} Hz`);
console.log(`Current:   ${s.inverterCurrent} A`);

console.log('\n--- EPS Backup ---');
console.log(`Voltage:   ${s.epsBackupVoltage} V`);
console.log(`Frequency: ${s.epsBackupFrequency} Hz`);

console.log('\n--- Temperatures ---');
console.log(`Heatsink:  ${s.inverterHeatsinkTemp} °C`);
console.log(`Charger:   ${s.chargerTemperature} °C`);
console.log(`Battery:   ${s.batteryTemperature} °C`);

console.log('\n--- Energy Today ---');
console.log(`PV generated:       ${s.pvEnergyTodayKwh} kWh`);
console.log(`Battery charged:    ${s.batteryChargeEnergyTodayKwh} kWh`);
console.log(`Battery discharged: ${s.batteryDischargeEnergyTodayKwh} kWh`);
console.log(`Grid import:        ${s.gridImportEnergyTodayKwh} kWh`);
console.log(`Grid export:        ${s.gridExportEnergyTodayKwh} kWh`);
console.log(`Consumption:        ${s.consumptionEnergyTodayKwh} kWh`);

console.log('\n--- Energy Totals ---');
console.log(`PV generated:       ${s.pvEnergyTotalKwh} kWh`);
console.log(`Battery charged:    ${s.batteryChargeEnergyTotalKwh} kWh`);
console.log(`Battery discharged: ${s.batteryDischargeEnergyTotalKwh} kWh`);
console.log(`Grid import:        ${s.gridImportEnergyTotalKwh} kWh`);
console.log(`Grid export:        ${s.gridExportEnergyTotalKwh} kWh`);
console.log(`Consumption:        ${s.consumptionEnergyTotalKwh} kWh`);
console.log(`Battery throughput: ${s.batteryThroughputTotalKwh} kWh`);
console.log(`Hours of operation: ${s.hoursOfOperation}`);

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

console.log('\n--- Power Flows ---');
const pf = s.powerFlows;
console.log(`Solar → House:   ${pf.solarToHouse} W`);
console.log(`Solar → Battery: ${pf.solarToBattery} W`);
console.log(`Solar → Grid:    ${pf.solarToGrid} W`);
console.log(`Battery → House: ${pf.batteryToHouse} W`);
console.log(`Battery → Grid:  ${pf.batteryToGrid} W`);
console.log(`Grid → House:    ${pf.gridToHouse} W`);
console.log(`Grid → Battery:  ${pf.gridToBattery} W`);

if (s.batteries.length > 0) {
  console.log('\n--- Batteries ---');
  for (const [i, b] of s.batteries.entries()) {
    console.log(`Battery ${i + 1}: SoC=${b.stateOfCharge}% V=${b.voltage}V serial=${b.serialNumber} cycles=${b.cycleCount}`);
    console.log(`  Charged: ${b.chargeEnergyTotalKwh} kWh  Discharged: ${b.dischargeEnergyTotalKwh} kWh`);
    console.log(`  Temp: ${b.temperatureMin}-${b.temperatureMax} °C  Cycles: ${b.cycleCount}`);
    console.log(`  Cells: ${b.cellVoltages.map(v => v.toFixed(3)).join(', ')} V`);
  }
}

if (s.meters.length > 0) {
  console.log('\n--- CT Meters ---');
  for (const [i, m] of s.meters.entries()) {
    const phases = m.voltage[1] !== 0 ? '3-phase' : '1-phase';
    console.log(`Meter ${i + 1} (slave 0x${m.slaveAddress.toString(16).padStart(2, '0')}): ${phases} serial=${m.serialNumber} factory=${m.factoryCode}`);
    console.log(`  Type: ${m.meterType}  HW: ${m.hardwareVersion}  SW: ${m.softwareVersion}`);
    console.log(`  Voltage:  ${m.voltage.map(v => v.toFixed(1) + 'V').join(' / ')}`);
    console.log(`  Current:  ${m.current.map(a => a.toFixed(2) + 'A').join(' / ')}`);
    console.log(`  Active:   ${m.activePower.map(w => w + 'W').join(' / ')}  Total: ${m.activePowerTotal}W`);
    console.log(`  Reactive: ${m.reactivePower.map(w => w + 'VAR').join(' / ')}  Total: ${m.reactivePowerTotal}VAR`);
    console.log(`  Apparent: ${m.apparentPower.map(w => w + 'VA').join(' / ')}  Total: ${m.apparentPowerTotal}VA`);
    console.log(`  PF:       ${m.powerFactor.map(p => p.toFixed(4)).join(' / ')}  Total: ${m.powerFactorTotal.toFixed(4)}`);
    console.log(`  Freq:     ${m.frequency.toFixed(2)} Hz`);
    console.log(`  Import:   ${m.importActiveEnergyKwh} kWh (active)  ${m.importReactiveEnergy} kVARh (reactive)`);
    console.log(`  Export:   ${m.exportActiveEnergyKwh} kWh (active)  ${m.exportReactiveEnergy} kVARh (reactive)`);
  }
}
