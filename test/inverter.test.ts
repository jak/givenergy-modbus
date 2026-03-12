import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server, type Socket } from 'net';
import { GivEnergyInverter } from '../src/inverter.js';
import { Gen2Inverter } from '../src/inverters/gen2.js';
import { Gen3Inverter } from '../src/inverters/gen3.js';
import { ThreePhaseInverter } from '../src/inverters/three-phase.js';
import { PollManager } from '../src/poll-manager.js';
import { PayloadEncoder } from '../src/codec.js';

// Helper: build a mock response frame for a read holding registers request
// (slave=0x11, fc=0x03, base=0, count=60) with 60 register values.
function buildIdentifyResponse(registers: number[]): Buffer {
  const serial = '**********';
  const inverterSerial = '**********';
  const slaveAddress = 0x11;
  const fc = 0x03;
  const baseRegister = 0;
  const registerCount = registers.length;

  const crcEnc = new PayloadEncoder();
  crcEnc.addUint8(slaveAddress);
  crcEnc.addUint8(fc);
  crcEnc.addString(inverterSerial, 10);
  crcEnc.addUint16(baseRegister);
  crcEnc.addUint16(registerCount);
  for (const val of registers) crcEnc.addUint16(val);
  const crc = crcEnc.crc;
  const swappedCrc = ((crc & 0xFF) << 8) | ((crc >> 8) & 0xFF);

  const bodyEnc = new PayloadEncoder();
  bodyEnc.addUint8(0x01); // uid
  bodyEnc.addUint8(0x02); // fid: transparent
  bodyEnc.addString(serial, 10);
  // 8-byte padding
  for (let i = 0; i < 7; i++) bodyEnc.addUint8(0x00);
  bodyEnc.addUint8(0x08);
  bodyEnc.addUint8(slaveAddress);
  bodyEnc.addUint8(fc);
  bodyEnc.addString(inverterSerial, 10);
  bodyEnc.addUint16(baseRegister);
  bodyEnc.addUint16(registerCount);
  for (const val of registers) bodyEnc.addUint16(val);
  bodyEnc.addUint16(swappedCrc);

  const body = bodyEnc.payload;
  const frameEnc = new PayloadEncoder();
  frameEnc.addUint16(0x5959); // TID
  frameEnc.addUint16(0x0001); // protocol ID
  frameEnc.addUint16(body.length);
  for (const byte of body) frameEnc.addUint8(byte);
  return frameEnc.payload;
}

// Helper: encode a 10-char string into 5 register values (high byte, low byte)
function stringToRegisters(str: string): number[] {
  const padded = str.padEnd(10, '\x00');
  const regs: number[] = [];
  for (let i = 0; i < 10; i += 2) {
    regs.push((padded.charCodeAt(i) << 8) | padded.charCodeAt(i + 1));
  }
  return regs;
}

describe('GivEnergyInverter', () => {
  it('exposes a static connect() factory method', () => {
    expect(typeof GivEnergyInverter.connect).toBe('function');
  });

  it('exposes shared control methods on prototype', () => {
    // Verify method signatures exist on the abstract class prototype
    // (subclasses inherit these shared methods)
    expect(typeof GivEnergyInverter.prototype.setMode).toBe('function');
    expect(typeof GivEnergyInverter.prototype.setDateTime).toBe('function');
    expect(typeof GivEnergyInverter.prototype.syncDateTime).toBe('function');
    expect(typeof GivEnergyInverter.prototype.reboot).toBe('function');
    expect(typeof GivEnergyInverter.prototype.stop).toBe('function');
    expect(typeof GivEnergyInverter.prototype.getData).toBe('function');
    expect(typeof GivEnergyInverter.prototype.unsafe_writeRegister).toBe('function');
  });

  it('Gen2Inverter exposes generation-specific methods', () => {
    expect(typeof Gen2Inverter.prototype.setChargeScheduleEnabled).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeScheduleEnabled).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeTarget).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeSlot).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeSlots).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeSlot).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeSlots).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeRate).toBe('function');
    expect(typeof Gen2Inverter.prototype.setChargeRatePercent).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeRate).toBe('function');
    expect(typeof Gen2Inverter.prototype.setDischargeRatePercent).toBe('function');
    expect(typeof Gen2Inverter.prototype.setBatteryReserve).toBe('function');
    expect(typeof Gen2Inverter.prototype.setBatteryPowerReserve).toBe('function');
  });

  it('Gen3Inverter exposes generation-specific methods including Gen3-only', () => {
    expect(typeof Gen3Inverter.prototype.setChargeScheduleEnabled).toBe('function');
    expect(typeof Gen3Inverter.prototype.setChargeSlot).toBe('function');
    expect(typeof Gen3Inverter.prototype.setExportLimit).toBe('function');
    expect(typeof Gen3Inverter.prototype.setBatteryPauseMode).toBe('function');
    expect(typeof Gen3Inverter.prototype.setPauseSlot).toBe('function');
  });

  it('ThreePhaseInverter exposes generation-specific methods', () => {
    expect(typeof ThreePhaseInverter.prototype.setChargeScheduleEnabled).toBe('function');
    expect(typeof ThreePhaseInverter.prototype.setChargeSlot).toBe('function');
    expect(typeof ThreePhaseInverter.prototype.setDischargeSlot).toBe('function');
  });

  it('connect() throws when initial poll produces empty serial number (#23)', async () => {
    // When connecting to a host that has port 8899 open but is not a GivEnergy
    // inverter, the poll completes with all-zero registers producing an empty
    // serial number. connect() should reject rather than returning a bogus inverter.
    const origStart = vi.spyOn(PollManager.prototype, 'start').mockResolvedValue(undefined);
    const origGetData = vi.spyOn(PollManager.prototype, 'getData').mockReturnValue({
      generation: 'gen2',
      serialNumber: '',
      modelCode: 0,
      solarPower: 0,
      pvString1Power: 0,
      pvString2Power: 0,
      batteryPower: 0,
      gridPower: 0,
      loadPower: 0,
      inverterOutputPower: 0,
      gridApparentPower: 0,
      epsBackupPower: 0,
      pvString1Voltage: 0,
      pvString2Voltage: 0,
      pvString1Current: 0,
      pvString2Current: 0,
      stateOfCharge: 0,
      batteryVoltage: 0,
      batteryCurrent: 0,
      gridVoltage: 0,
      gridFrequency: 0,
      inverterCurrent: 0,
      epsBackupVoltage: 0,
      epsBackupFrequency: 0,
      inverterHeatsinkTemp: 0,
      chargerTemperature: 0,
      batteryTemperature: 0,
      pvEnergyTotalKwh: 0,
      batteryChargeEnergyTotalKwh: 0,
      batteryDischargeEnergyTotalKwh: 0,
      gridImportEnergyTotalKwh: 0,
      gridExportEnergyTotalKwh: 0,
      consumptionEnergyTotalKwh: 0,
      batteryThroughputTotalKwh: 0,
      hoursOfOperation: 0,
      pvEnergyTodayKwh: 0,
      batteryChargeEnergyTodayKwh: 0,
      batteryDischargeEnergyTodayKwh: 0,
      gridImportEnergyTodayKwh: 0,
      gridExportEnergyTodayKwh: 0,
      consumptionEnergyTodayKwh: 0,
      chargeSlots: [],
      dischargeSlots: [],
      enableCharge: false,
      enableDischarge: false,
      chargeTargetStateOfCharge: 0,
      systemTime: new Date(),
      powerFlows: {
        solarToHouse: 0, solarToBattery: 0, solarToGrid: 0,
        batteryToHouse: 0, batteryToGrid: 0, gridToHouse: 0, gridToBattery: 0,
      },
      batteries: [],
      meters: [],
    } as any);
    const origStop = vi.spyOn(PollManager.prototype, 'stop').mockResolvedValue(undefined);

    try {
      await expect(GivEnergyInverter.connect({ host: '192.168.50.118' }))
        .rejects.toThrow('No valid inverter found');
    } finally {
      origStart.mockRestore();
      origGetData.mockRestore();
      origStop.mockRestore();
    }
  });

  it('connect() throws when serial is NUL-filled from all-zero registers', async () => {
    // registersToString converts all-zero registers to NUL bytes (\x00),
    // which trim() does NOT strip. This is the common case when a non-inverter
    // device has port 8899 open — registers read as zeros, producing NUL-filled serial.
    const origStart = vi.spyOn(PollManager.prototype, 'start').mockResolvedValue(undefined);
    const origGetData = vi.spyOn(PollManager.prototype, 'getData').mockReturnValue({
      generation: 'gen2',
      serialNumber: '\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
      modelCode: 0,
      solarPower: 0, pvString1Power: 0, pvString2Power: 0,
      batteryPower: 0, gridPower: 0, loadPower: 0,
      inverterOutputPower: 0, gridApparentPower: 0, epsBackupPower: 0,
      pvString1Voltage: 0, pvString2Voltage: 0,
      pvString1Current: 0, pvString2Current: 0,
      stateOfCharge: 0, batteryVoltage: 0, batteryCurrent: 0,
      gridVoltage: 0, gridFrequency: 0, inverterCurrent: 0,
      epsBackupVoltage: 0, epsBackupFrequency: 0,
      inverterHeatsinkTemp: 0, chargerTemperature: 0, batteryTemperature: 0,
      pvEnergyTotalKwh: 0, batteryChargeEnergyTotalKwh: 0,
      batteryDischargeEnergyTotalKwh: 0, gridImportEnergyTotalKwh: 0,
      gridExportEnergyTotalKwh: 0, consumptionEnergyTotalKwh: 0,
      batteryThroughputTotalKwh: 0, hoursOfOperation: 0,
      pvEnergyTodayKwh: 0, batteryChargeEnergyTodayKwh: 0,
      batteryDischargeEnergyTodayKwh: 0, gridImportEnergyTodayKwh: 0,
      gridExportEnergyTodayKwh: 0, consumptionEnergyTodayKwh: 0,
      chargeSlots: [], dischargeSlots: [],
      enableCharge: false, enableDischarge: false, chargeTargetStateOfCharge: 0,
      systemTime: new Date(),
      powerFlows: {
        solarToHouse: 0, solarToBattery: 0, solarToGrid: 0,
        batteryToHouse: 0, batteryToGrid: 0, gridToHouse: 0, gridToBattery: 0,
      },
      batteries: [], meters: [],
    } as any);
    const origStop = vi.spyOn(PollManager.prototype, 'stop').mockResolvedValue(undefined);

    try {
      await expect(GivEnergyInverter.connect({ host: '192.168.50.118' }))
        .rejects.toThrow('No valid inverter found');
    } finally {
      origStart.mockRestore();
      origGetData.mockRestore();
      origStop.mockRestore();
    }
  });

  it('all subclasses extend GivEnergyInverter', () => {
    expect(Gen2Inverter.prototype).toBeInstanceOf(GivEnergyInverter);
    expect(Gen3Inverter.prototype).toBeInstanceOf(GivEnergyInverter);
    expect(ThreePhaseInverter.prototype).toBeInstanceOf(GivEnergyInverter);
  });

  it('identify() returns serial number and generation from a single register read', async () => {
    const sockets: Socket[] = [];
    const registers = new Array(60).fill(0);
    // HR(0) = device type code 0x2001 (Gen2 hybrid)
    registers[0] = 0x2001;
    // HR(6..10) = serial "SD2227G895" encoded as 5 registers
    const serialRegs = stringToRegisters('SD2227G895');
    for (let i = 0; i < 5; i++) registers[6 + i] = serialRegs[i];
    // HR(21) = firmware version 899
    registers[21] = 899;

    const response = buildIdentifyResponse(registers);
    const server: Server = createServer((socket) => {
      sockets.push(socket);
      socket.once('data', () => socket.write(response));
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;
      const result = await GivEnergyInverter.identify({ host: '127.0.0.1', port });
      expect(result.serialNumber).toBe('SD2227G895');
      expect(result.generation).toBe('gen2');
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  });

  it('identify() detects gen3 from device type code and firmware version', async () => {
    const sockets: Socket[] = [];
    const registers = new Array(60).fill(0);
    registers[0] = 0x2001;
    const serialRegs = stringToRegisters('EE1234G567');
    for (let i = 0; i < 5; i++) registers[6 + i] = serialRegs[i];
    registers[21] = 301;

    const response = buildIdentifyResponse(registers);
    const server: Server = createServer((socket) => {
      sockets.push(socket);
      socket.once('data', () => socket.write(response));
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;
      const result = await GivEnergyInverter.identify({ host: '127.0.0.1', port });
      expect(result.serialNumber).toBe('EE1234G567');
      expect(result.generation).toBe('gen3');
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  });

  it('identify() falls back to serial prefix detection when model code is zero', async () => {
    const sockets: Socket[] = [];
    const registers = new Array(60).fill(0);
    const serialRegs = stringToRegisters('SA9999X123');
    for (let i = 0; i < 5; i++) registers[6 + i] = serialRegs[i];

    const response = buildIdentifyResponse(registers);
    const server: Server = createServer((socket) => {
      sockets.push(socket);
      socket.once('data', () => socket.write(response));
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;
      const result = await GivEnergyInverter.identify({ host: '127.0.0.1', port });
      expect(result.serialNumber).toBe('SA9999X123');
      expect(result.generation).toBe('three_phase');
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  });

  it('identify() throws when serial number is empty (not a GivEnergy inverter)', async () => {
    const sockets: Socket[] = [];
    const registers = new Array(60).fill(0);

    const response = buildIdentifyResponse(registers);
    const server: Server = createServer((socket) => {
      sockets.push(socket);
      socket.once('data', () => socket.write(response));
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;
      await expect(GivEnergyInverter.identify({ host: '127.0.0.1', port }))
        .rejects.toThrow('No valid inverter found');
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  });

  it('identify() closes the connection after reading identity', async () => {
    const sockets: Socket[] = [];
    const registers = new Array(60).fill(0);
    registers[0] = 0x2001;
    const serialRegs = stringToRegisters('SD2227G895');
    for (let i = 0; i < 5; i++) registers[6 + i] = serialRegs[i];
    registers[21] = 899;

    const response = buildIdentifyResponse(registers);
    const server: Server = createServer((socket) => {
      sockets.push(socket);
      socket.once('data', () => socket.write(response));
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;
      await GivEnergyInverter.identify({ host: '127.0.0.1', port });

      // Give a tick for cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      // All sockets should be destroyed after identify completes
      for (const s of sockets) {
        expect(s.destroyed).toBe(true);
      }
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  });
});
