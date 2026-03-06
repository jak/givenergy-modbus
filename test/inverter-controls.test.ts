import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'net';
import { Framer } from '../src/framer.js';
import { encodeHeartbeatResponse } from '../src/pdu/heartbeat.js';
import { GivEnergyInverter, validateStateOfCharge, validateTime } from '../src/inverter.js';

// ── Mock Inverter ─────────────────────────────────────────────────────────────

interface WrittenRegister {
  register: number;
  value: number;
}

interface MockInverterState {
  server: Server;
  port: number;
  writtenRegisters: WrittenRegister[];
  close(): Promise<void>;
}

/**
 * Parse a GivEnergy request frame sent by the client.
 */
function parseRequestFrame(frame: Buffer): {
  type: 'heartbeat';
  dataAdapterSerial: string;
} | {
  type: 'transparent';
  slaveAddress: number;
  transparentFunctionCode: number;
  baseRegister: number;
  registerCount: number;
  registerValue: number;
} | null {
  if (frame.length < 8) return null;
  const fid = frame[7];

  if (fid === 0x01) {
    const dataAdapterSerial = frame.subarray(8, 18).toString('latin1');
    return { type: 'heartbeat', dataAdapterSerial };
  }

  if (fid === 0x02) {
    if (frame.length < 32) return null;
    const slaveAddress = frame[26];
    const transparentFunctionCode = frame[27];
    const baseRegister = frame.readUInt16BE(28);
    const registerCount = frame.readUInt16BE(30);
    return {
      type: 'transparent',
      slaveAddress,
      transparentFunctionCode,
      baseRegister,
      registerCount,
      registerValue: frame.readUInt16BE(30),
    };
  }

  return null;
}

function buildTransparentResponse(
  inverterSerial: string,
  slave: number,
  fc: number,
  baseReg: number,
  values: number[],
): Buffer {
  const inverterSerialBuf = Buffer.from(inverterSerial, 'latin1');
  const adapterSerial = Buffer.from('CE1234G567', 'latin1');
  const padding = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08]);

  const sub: number[] = [
    slave, fc,
    ...Array.from(inverterSerialBuf),
    (baseReg >> 8) & 0xFF, baseReg & 0xFF,
    (values.length >> 8) & 0xFF, values.length & 0xFF,
  ];
  for (const v of values) {
    sub.push((v >> 8) & 0xFF, v & 0xFF);
  }
  sub.push(0x00, 0x00); // CRC placeholder

  const body = Buffer.concat([adapterSerial, padding, Buffer.from(sub)]);
  const payloadLen = body.length + 2;
  return Buffer.from([
    0x59, 0x59, 0x00, 0x01,
    (payloadLen >> 8) & 0xFF, payloadLen & 0xFF,
    0x01, 0x02,
    ...Array.from(body),
  ]);
}

function makeHoldingRegisters(serial: string): number[] {
  const regs = new Array(1200).fill(0);

  // HR(13-17) = serial encoded as 5×uint16
  for (let i = 0; i < 5; i++) {
    regs[13 + i] = (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1);
  }
  // HR(30) = 1 (modbus_address — used in sanity check)
  regs[30] = 1;
  // HR(34) = 40 (modbus_version raw → toCenti = 0.40, < 2 passes sanity check)
  regs[34] = 40;
  // HR(94) = 30 (charge slot 1 start = 00:30)
  regs[94] = 30;
  // HR(95) = 430 (charge slot 1 end = 04:30)
  regs[95] = 430;
  // HR(96) = 1 (enable_charge)
  regs[96] = 1;
  // HR(116) = 100 (charge_target_soc)
  regs[116] = 100;

  // Gen3 detection: HR(0) = 0x2003 (HYBRID_GEN3), HR(21) = 300 (ARM firmware v300)
  if (serial.startsWith('EE')) {
    regs[0] = 0x2003;
    regs[21] = 300;
  }

  return regs;
}

function makeInputRegisters(): number[] {
  const regs = new Array(240).fill(0);
  regs[41] = 350; // heatsink temp → toDeci = 35°C
  regs[59] = 75;  // battery_percent = 75%
  regs[9] = 5000; // f_ac1 raw
  return regs;
}

function makeBatteryRegisters(bserial: string): number[] {
  const regs = new Array(60).fill(0);
  for (let i = 0; i < 5; i++) {
    regs[50 + i] = (bserial.charCodeAt(i * 2) << 8) | bserial.charCodeAt(i * 2 + 1);
  }
  regs[40] = 80; // SOC at IR(100) → offset 40
  for (let i = 0; i < 16; i++) {
    regs[i] = 3250; // cell voltages
  }
  return regs;
}

async function startMockInverter(serial: string): Promise<MockInverterState> {
  const state: MockInverterState = {
    server: null as any,
    port: 0,
    writtenRegisters: [],
    close: async () => {
      await new Promise<void>(resolve => state.server.close(() => resolve()));
    },
  };

  await new Promise<void>(resolve => {
    state.server = createServer((socket: Socket) => {
      const framer = new Framer();
      socket.on('data', (data: Buffer) => {
        const results = framer.decode(data);
        for (const r of results) {
          if (r.type !== 'frame') continue;
          const req = parseRequestFrame(r.data);
          if (!req) continue;
          if (req.type === 'heartbeat') {
            socket.write(encodeHeartbeatResponse(req.dataAdapterSerial));
          } else if (req.type === 'transparent') {
            const { slaveAddress, transparentFunctionCode: fc, baseRegister, registerCount, registerValue } = req;
            if (fc === 0x03) {
              // Read holding registers
              const allRegs = makeHoldingRegisters(serial);
              const values = allRegs.slice(baseRegister, baseRegister + registerCount);
              socket.write(buildTransparentResponse(serial, slaveAddress, fc, baseRegister, values));
            } else if (fc === 0x04) {
              let values: number[];
              if (slaveAddress === 0x11) {
                const allRegs = makeInputRegisters();
                values = allRegs.slice(baseRegister, baseRegister + registerCount);
              } else if (slaveAddress >= 0x32 && slaveAddress <= 0x37) {
                let allRegs: number[];
                if (slaveAddress === 0x32) {
                  allRegs = makeBatteryRegisters('CE1234B001');
                } else {
                  allRegs = new Array(60).fill(0);
                }
                values = allRegs.slice(baseRegister - 60, baseRegister - 60 + registerCount);
              } else {
                continue;
              }
              socket.write(buildTransparentResponse(serial, slaveAddress, fc, baseRegister, values));
            } else if (fc === 0x06) {
              // Write holding register — record and acknowledge
              state.writtenRegisters.push({ register: baseRegister, value: registerValue });
              socket.write(buildTransparentResponse(serial, slaveAddress, fc, baseRegister, [registerValue]));
            }
          }
        }
      });
    });
    state.server.listen(0, () => {
      state.port = (state.server.address() as { port: number }).port;
      resolve();
    });
  });

  return state;
}

// Helper: get the last written register
function lastWritten(state: MockInverterState): WrittenRegister | undefined {
  return state.writtenRegisters[state.writtenRegisters.length - 1];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Shared validation helpers', () => {
  it('validateStateOfCharge throws below minimum', () => {
    expect(() => validateStateOfCharge(3)).toThrow(RangeError);
  });

  it('validateStateOfCharge throws above maximum', () => {
    expect(() => validateStateOfCharge(101)).toThrow(RangeError);
  });

  it('validateStateOfCharge accepts valid values', () => {
    expect(() => validateStateOfCharge(4)).not.toThrow();
    expect(() => validateStateOfCharge(100)).not.toThrow();
    expect(() => validateStateOfCharge(50)).not.toThrow();
  });

  it('validateTime throws for invalid hour', () => {
    expect(() => validateTime('25:00')).toThrow(RangeError);
  });

  it('validateTime throws for invalid minute', () => {
    expect(() => validateTime('12:60')).toThrow(RangeError);
  });

  it('validateTime throws for non-time string', () => {
    expect(() => validateTime('notvalid')).toThrow(RangeError);
  });

  it('validateTime accepts valid times', () => {
    expect(() => validateTime('00:00')).not.toThrow();
    expect(() => validateTime('23:59')).not.toThrow();
    expect(() => validateTime('1:00')).not.toThrow();
  });
});

// ── Gen2Inverter Tests ─────────────────────────────────────────────────────

describe('Gen2Inverter controls', () => {
  let mock: MockInverterState;
  let inv: GivEnergyInverter;

  beforeEach(async () => {
    // CE prefix → Gen2
    mock = await startMockInverter('CE1234B567');
    inv = await GivEnergyInverter.connect({ host: '127.0.0.1', port: mock.port });
  }, 20000);

  afterEach(async () => {
    await inv.stop();
    await mock.close();
  });

  it('setChargeSlot(1, config) writes HR(94) and HR(95)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeSlot(1, { start: '01:00', end: '02:30' });
    expect(mock.writtenRegisters).toContainEqual({ register: 94, value: 100 }); // 1*100+0
    expect(mock.writtenRegisters).toContainEqual({ register: 95, value: 230 }); // 2*100+30
  }, 20000);

  it('setChargeSlot(2, ...) throws RangeError', async () => {
    await expect((inv as any).setChargeSlot(2, { start: '01:00', end: '02:00' })).rejects.toThrow(RangeError);
  }, 20000);

  it('setChargeSlot(1, { targetStateOfCharge: 80 }) does not throw (silently ignored)', async () => {
    mock.writtenRegisters.length = 0;
    await expect(
      (inv as any).setChargeSlot(1, { start: '01:00', end: '02:00', targetStateOfCharge: 80 })
    ).resolves.not.toThrow();
    // Should only write start/end registers, not SOC
    expect(mock.writtenRegisters.length).toBe(2);
    expect(mock.writtenRegisters.map(w => w.register)).not.toContain(242);
  }, 20000);

  it('setChargeSlots with > 1 slot throws', async () => {
    await expect((inv as any).setChargeSlots([
      { start: '01:00', end: '02:00' },
      { start: '03:00', end: '04:00' },
    ])).rejects.toThrow(RangeError);
  }, 20000);

  it('setDischargeSlot(1, ...) writes HR(56) and HR(57)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setDischargeSlot(1, { start: '06:00', end: '07:30' });
    expect(mock.writtenRegisters).toContainEqual({ register: 56, value: 600 });
    expect(mock.writtenRegisters).toContainEqual({ register: 57, value: 730 });
  }, 20000);

  it('setDischargeSlot(2, ...) writes HR(44) and HR(45)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setDischargeSlot(2, { start: '08:00', end: '09:00' });
    expect(mock.writtenRegisters).toContainEqual({ register: 44, value: 800 });
    expect(mock.writtenRegisters).toContainEqual({ register: 45, value: 900 });
  }, 20000);

  it('setDischargeSlot(3, ...) throws RangeError', async () => {
    await expect((inv as any).setDischargeSlot(3, { start: '01:00', end: '02:00' })).rejects.toThrow(RangeError);
  }, 20000);

  it('setChargeScheduleEnabled(true) writes HR(96)=1', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeScheduleEnabled(true);
    expect(lastWritten(mock)).toEqual({ register: 96, value: 1 });
  }, 20000);

  it('setDischargeScheduleEnabled(false) writes HR(59)=0', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setDischargeScheduleEnabled(false);
    expect(lastWritten(mock)).toEqual({ register: 59, value: 0 });
  }, 20000);

  it('setChargeTarget(80) writes HR(116)=80', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeTarget(80);
    expect(lastWritten(mock)).toEqual({ register: 116, value: 80 });
  }, 20000);

  it('setChargeRatePercent(50) writes HR(313)=50', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeRatePercent(50);
    expect(lastWritten(mock)).toEqual({ register: 313, value: 50 });
  }, 20000);

  it('setDischargeRatePercent(30) writes HR(314)=30', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setDischargeRatePercent(30);
    expect(lastWritten(mock)).toEqual({ register: 314, value: 30 });
  }, 20000);

  it('setBatteryReserve(10) writes HR(110)=10', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setBatteryReserve(10);
    expect(lastWritten(mock)).toEqual({ register: 110, value: 10 });
  }, 20000);

  it('setBatteryPowerReserve(10) writes HR(114)=10', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setBatteryPowerReserve(10);
    expect(lastWritten(mock)).toEqual({ register: 114, value: 10 });
  }, 20000);
});

// ── Gen3Inverter Tests ─────────────────────────────────────────────────────

describe('Gen3Inverter controls', () => {
  let mock: MockInverterState;
  let inv: GivEnergyInverter;

  beforeEach(async () => {
    // EE prefix → Gen3
    mock = await startMockInverter('EE1234B567');
    inv = await GivEnergyInverter.connect({ host: '127.0.0.1', port: mock.port });
  }, 20000);

  afterEach(async () => {
    await inv.stop();
    await mock.close();
  });

  it('setChargeSlot(1, config) writes HR(94) and HR(95)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeSlot(1, { start: '01:00', end: '02:30' });
    expect(mock.writtenRegisters).toContainEqual({ register: 94, value: 100 });
    expect(mock.writtenRegisters).toContainEqual({ register: 95, value: 230 });
  }, 20000);

  it('setChargeSlot(10, config) writes HR(267) and HR(268) — slot 10 registers', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeSlot(10, { start: '10:00', end: '11:00' });
    expect(mock.writtenRegisters).toContainEqual({ register: 267, value: 1000 });
    expect(mock.writtenRegisters).toContainEqual({ register: 268, value: 1100 });
  }, 20000);

  it('setChargeSlot(11, ...) throws RangeError', async () => {
    await expect((inv as any).setChargeSlot(11, { start: '01:00', end: '02:00' })).rejects.toThrow(RangeError);
  }, 20000);

  it('setChargeSlot(1, { targetStateOfCharge: 80 }) also writes HR(242)=80', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeSlot(1, { start: '01:00', end: '02:00', targetStateOfCharge: 80 });
    expect(mock.writtenRegisters).toContainEqual({ register: 94, value: 100 });
    expect(mock.writtenRegisters).toContainEqual({ register: 95, value: 200 });
    expect(mock.writtenRegisters).toContainEqual({ register: 242, value: 80 });
  }, 20000);

  it('setDischargeSlot(10, ...) works — slots 1-10 valid', async () => {
    mock.writtenRegisters.length = 0;
    await expect((inv as any).setDischargeSlot(10, { start: '10:00', end: '11:00' })).resolves.not.toThrow();
    // DISCHARGE_SLOT_REGISTERS[9] = { start: 297, end: 298 }
    expect(mock.writtenRegisters).toContainEqual({ register: 297, value: 1000 });
    expect(mock.writtenRegisters).toContainEqual({ register: 298, value: 1100 });
  }, 20000);

  it('setChargeSlots([]) zeros all 10 slots without throwing', async () => {
    mock.writtenRegisters.length = 0;
    await expect((inv as any).setChargeSlots([])).resolves.not.toThrow();
    // Each slot writes 2 registers (start=0, end=0), 10 slots = 20 writes
    expect(mock.writtenRegisters.length).toBe(20);
    for (const w of mock.writtenRegisters) {
      expect(w.value).toBe(0);
    }
  }, 20000);

  it('setChargeSlots with 11 items throws', async () => {
    const slots = Array.from({ length: 11 }, () => ({ start: '01:00', end: '02:00' }));
    await expect((inv as any).setChargeSlots(slots)).rejects.toThrow(RangeError);
  }, 20000);

  it('setChargeScheduleEnabled(true) writes HR(96)=1', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeScheduleEnabled(true);
    expect(lastWritten(mock)).toEqual({ register: 96, value: 1 });
  }, 20000);

  it('setBatteryPauseMode("pause_charge") writes HR(318)=1', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setBatteryPauseMode('pause_charge');
    expect(lastWritten(mock)).toEqual({ register: 318, value: 1 });
  }, 20000);

  it('setBatteryPauseMode("pause_both") writes HR(318)=3', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setBatteryPauseMode('pause_both');
    expect(lastWritten(mock)).toEqual({ register: 318, value: 3 });
  }, 20000);

  it('setExportLimit(5000) writes HR(2071)=5000', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setExportLimit(5000);
    expect(lastWritten(mock)).toEqual({ register: 2071, value: 5000 });
  }, 20000);

  it('setExportLimit(70000) throws RangeError', async () => {
    await expect((inv as any).setExportLimit(70000)).rejects.toThrow(RangeError);
  }, 20000);

  it('setPauseSlot writes HR(319) and HR(320)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setPauseSlot({ start: '01:00', end: '02:30' });
    expect(mock.writtenRegisters).toContainEqual({ register: 319, value: 100 });
    expect(mock.writtenRegisters).toContainEqual({ register: 320, value: 230 });
  }, 20000);
});

// ── ThreePhaseInverter Tests ───────────────────────────────────────────────

describe('ThreePhaseInverter controls', () => {
  let mock: MockInverterState;
  let inv: GivEnergyInverter;

  beforeEach(async () => {
    // SA prefix → three_phase
    mock = await startMockInverter('SA1234B567');
    inv = await GivEnergyInverter.connect({ host: '127.0.0.1', port: mock.port });
  }, 20000);

  afterEach(async () => {
    await inv.stop();
    await mock.close();
  });

  it('setChargeSlot(1, config) writes HR(1113) and HR(1114)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeSlot(1, { start: '01:00', end: '02:30' });
    expect(mock.writtenRegisters).toContainEqual({ register: 1113, value: 100 });
    expect(mock.writtenRegisters).toContainEqual({ register: 1114, value: 230 });
  }, 20000);

  it('setChargeSlot(2, config) writes HR(1115) and HR(1116)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeSlot(2, { start: '03:00', end: '04:00' });
    expect(mock.writtenRegisters).toContainEqual({ register: 1115, value: 300 });
    expect(mock.writtenRegisters).toContainEqual({ register: 1116, value: 400 });
  }, 20000);

  it('setChargeSlot(3, ...) throws RangeError', async () => {
    await expect((inv as any).setChargeSlot(3, { start: '01:00', end: '02:00' })).rejects.toThrow(RangeError);
  }, 20000);

  it('rejects discharge slot > 2', async () => {
    await expect(
      inv.setDischargeSlot(3, { start: '01:00', end: '02:00' }),
    ).rejects.toThrow(RangeError);
  }, 20000);

  it('setDischargeSlot(1, ...) writes HR(1118) and HR(1119)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setDischargeSlot(1, { start: '05:00', end: '06:00' });
    expect(mock.writtenRegisters).toContainEqual({ register: 1118, value: 500 });
    expect(mock.writtenRegisters).toContainEqual({ register: 1119, value: 600 });
  }, 20000);

  it('setDischargeSlot(2, ...) writes HR(1120) and HR(1121)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setDischargeSlot(2, { start: '07:00', end: '08:00' });
    expect(mock.writtenRegisters).toContainEqual({ register: 1120, value: 700 });
    expect(mock.writtenRegisters).toContainEqual({ register: 1121, value: 800 });
  }, 20000);

  it('setChargeScheduleEnabled(true) writes HR(1123)=1 AND HR(1112)=1 (two writes)', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeScheduleEnabled(true);
    expect(mock.writtenRegisters).toContainEqual({ register: 1123, value: 1 });
    expect(mock.writtenRegisters).toContainEqual({ register: 1112, value: 1 });
    expect(mock.writtenRegisters.length).toBe(2);
  }, 20000);

  it('setChargeRatePercent(75) writes HR(1110)=75', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setChargeRatePercent(75);
    expect(lastWritten(mock)).toEqual({ register: 1110, value: 75 });
  }, 20000);

  it('setDischargeRatePercent(50) writes HR(1108)=50', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setDischargeRatePercent(50);
    expect(lastWritten(mock)).toEqual({ register: 1108, value: 50 });
  }, 20000);

  it('setBatteryReserve(15) writes HR(1109)=15', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setBatteryReserve(15);
    expect(lastWritten(mock)).toEqual({ register: 1109, value: 15 });
  }, 20000);

  it('setBatteryPowerReserve(10) writes HR(1078)=10', async () => {
    mock.writtenRegisters.length = 0;
    await (inv as any).setBatteryPowerReserve(10);
    expect(lastWritten(mock)).toEqual({ register: 1078, value: 10 });
  }, 20000);
});

// ── Shared control methods (via Gen3Inverter) ──────────────────────────────

describe('Shared control methods (tested via Gen3Inverter)', () => {
  let mock: MockInverterState;
  let inv: GivEnergyInverter;

  beforeEach(async () => {
    mock = await startMockInverter('EE1234B567');
    inv = await GivEnergyInverter.connect({ host: '127.0.0.1', port: mock.port });
  }, 20000);

  afterEach(async () => {
    await inv.stop();
    await mock.close();
  });

  it('setMode("eco") writes HR(27)=1 then HR(59)=0', async () => {
    mock.writtenRegisters.length = 0;
    await inv.setMode('eco');
    expect(mock.writtenRegisters).toEqual([
      { register: 27, value: 1 },
      { register: 59, value: 0 },
    ]);
  }, 20000);

  it('setMode("timed_demand") writes HR(27)=1 then HR(59)=1', async () => {
    mock.writtenRegisters.length = 0;
    await inv.setMode('timed_demand');
    expect(mock.writtenRegisters).toEqual([
      { register: 27, value: 1 },
      { register: 59, value: 1 },
    ]);
  }, 20000);

  it('setMode("timed_export") writes HR(27)=0 then HR(59)=1', async () => {
    mock.writtenRegisters.length = 0;
    await inv.setMode('timed_export');
    expect(mock.writtenRegisters).toEqual([
      { register: 27, value: 0 },
      { register: 59, value: 1 },
    ]);
  }, 20000);

  it('reboot() writes HR(163)=100', async () => {
    mock.writtenRegisters.length = 0;
    await inv.reboot();
    expect(lastWritten(mock)).toEqual({ register: 163, value: 100 });
  }, 20000);

  it('unsafe_writeRegister(42, 99) writes HR(42)=99', async () => {
    mock.writtenRegisters.length = 0;
    await inv.unsafe_writeRegister(42, 99);
    expect(lastWritten(mock)).toEqual({ register: 42, value: 99 });
  }, 20000);
});
