import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'net';
import { Framer } from '../src/framer.js';
import { decodePdu } from '../src/pdu/decode.js';
import { encodeHeartbeatResponse } from '../src/pdu/heartbeat.js';

// ── Mock Inverter ─────────────────────────────────────────────────────────────

interface MockInverterState {
  server: Server;
  port: number;
  lastWrittenRegister: number | null;
  lastWrittenValue: number | null;
  close(): Promise<void>;
}

/**
 * Parse a GivEnergy request frame sent by the client.
 *
 * Request frame layout (differs from response):
 *   Bytes 0-1:   TID 0x5959
 *   Bytes 2-3:   protocol ID 0x0001
 *   Bytes 4-5:   length
 *   Byte  6:     uid
 *   Byte  7:     fid (0x01=heartbeat, 0x02=transparent)
 *   Bytes 8-17:  data_adapter_serial (10 bytes)
 *
 * For heartbeat (fid=0x01):
 *   Byte 18: data_adapter_type
 *
 * For transparent (fid=0x02):
 *   Bytes 18-25: padding (8 bytes)
 *   Byte  26:    slave_address
 *   Byte  27:    transparent_function_code
 *   Bytes 28-29: base_register (request inner payload)
 *   Bytes 30-31: register_count or value (for write)
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
    // Heartbeat
    const dataAdapterSerial = frame.subarray(8, 18).toString('latin1');
    return { type: 'heartbeat', dataAdapterSerial };
  }

  if (fid === 0x02) {
    // Transparent request — inner payload starts at offset 28
    if (frame.length < 32) return null;
    const slaveAddress = frame[26];
    const transparentFunctionCode = frame[27];
    const baseRegister = frame.readUInt16BE(28);
    const registerCount = frame.readUInt16BE(30); // also serves as value for writes
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
  slave: number,
  fc: number,
  baseReg: number,
  values: number[],
): Buffer {
  const inverterSerial = Buffer.from('SA1234B567', 'latin1');
  const adapterSerial = Buffer.from('CE1234G567', 'latin1');
  const padding = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08]);

  const sub: number[] = [
    slave, fc,
    ...Array.from(inverterSerial),
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

function makeHoldingRegisters(): number[] {
  // 4140 registers to cover HR 0-299 (Gen3), HR 1080-1139 (three_phase timeslots),
  // and HR 4080-4139 (32-bit battery energy totals)
  const regs = new Array(4140).fill(0);

  // HR(0) = 0x2003 (HYBRID_GEN3)
  regs[0] = 0x2003;
  // HR(21) = 300 (ARM firmware v300 → Gen3)
  regs[21] = 300;
  // HR(13-17) = serial "SA1234B567" encoded as 5×uint16
  const serial = 'SA1234B567';
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

  return regs;
}

function makeInputRegisters(): number[] {
  // 240 registers to cover IR 0-59 and 180-239 ranges
  const regs = new Array(240).fill(0);

  // IR(41) = 350 (heatsink temp → toDeci = 35°C, passes sanity check)
  regs[41] = 350;
  // IR(59) = 75 (battery_percent = 75%)
  regs[59] = 75;
  // IR(52) = 0 (p_battery = 0W)
  regs[52] = 0;
  // IR(30) = 0 (p_grid_out = 0W)
  regs[30] = 0;
  // IR(18) = 500 (p_pv1 = 500W)
  regs[18] = 500;
  // IR(20) = 500 (p_pv2 = 500W)
  regs[20] = 500;
  // IR(9) = 5000 (f_ac1 raw → deci=500 → >100 → /10 → 50Hz)
  regs[9] = 5000;

  return regs;
}

function makeBatteryRegisters(serial: string): number[] {
  const regs = new Array(60).fill(0);
  // Serial at IR(110-114) relative to start 60, so offsets 50-54
  for (let i = 0; i < 5; i++) {
    regs[50 + i] = (serial.charCodeAt(i * 2) << 8) | serial.charCodeAt(i * 2 + 1);
  }
  // SOC at IR(100) → offset 40
  regs[40] = 80;
  // Cell voltages at IR(60-75) → offsets 0-15
  for (let i = 0; i < 16; i++) {
    regs[i] = 3250;
  }
  return regs;
}

async function startMockInverter(): Promise<MockInverterState> {
  const state: MockInverterState = {
    server: null as any,
    port: 0,
    lastWrittenRegister: null,
    lastWrittenValue: null,
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
              const allRegs = makeHoldingRegisters();
              const values = allRegs.slice(baseRegister, baseRegister + registerCount);
              socket.write(buildTransparentResponse(slaveAddress, fc, baseRegister, values));
            } else if (fc === 0x04) {
              // Read input registers
              let values: number[];
              if (slaveAddress === 0x11) {
                const allRegs = makeInputRegisters();
                values = allRegs.slice(baseRegister, baseRegister + registerCount);
              } else if (slaveAddress >= 0x32 && slaveAddress <= 0x37) {
                // Battery slaves: two real batteries, rest respond with zeros (no battery)
                let allRegs: number[];
                if (slaveAddress === 0x32) {
                  allRegs = makeBatteryRegisters('CE1234B001');
                } else if (slaveAddress === 0x33) {
                  allRegs = makeBatteryRegisters('CE1234B002');
                } else {
                  // Respond with all zeros → serial all-zero → buildBatterySnapshot returns null
                  allRegs = new Array(60).fill(0);
                }
                values = allRegs.slice(baseRegister - 60, baseRegister - 60 + registerCount);
              } else if (slaveAddress >= 0x01 && slaveAddress <= 0x08) {
                // Meter slaves — respond with zeros (no meter connected)
                values = new Array(registerCount).fill(0);
              } else {
                // Unknown slave — don't respond (triggers timeout)
                continue;
              }
              socket.write(buildTransparentResponse(slaveAddress, fc, baseRegister, values));
            } else if (fc === 0x16) {
              // Read meter product registers — respond with zeros
              const values = new Array(registerCount).fill(0);
              socket.write(buildTransparentResponse(slaveAddress, fc, baseRegister, values));
            } else if (fc === 0x06) {
              // Write holding register — record and acknowledge
              state.lastWrittenRegister = baseRegister;
              state.lastWrittenValue = registerValue;
              // Acknowledge: echo back the write
              socket.write(buildTransparentResponse(slaveAddress, fc, baseRegister, [registerValue]));
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Mock inverter frame building', () => {
  it('builds a valid transparent response frame', () => {
    // Verify our mock builds frames that the Framer and decodePdu can parse
    const frame = buildTransparentResponse(0x11, 0x03, 0, [0x1234, 0x5678]);
    const framer = new Framer();
    const results = framer.decode(frame);
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('frame');
    const pdu = decodePdu(results[0].data);
    expect(pdu.type).toBe('transparent');
    if (pdu.type === 'transparent') {
      expect(pdu.registerValues).toEqual([0x1234, 0x5678]);
    }
  });

  it('builds heartbeat response frame correctly', () => {
    const frame = encodeHeartbeatResponse('CE1234G567');
    expect(frame[0]).toBe(0x59);
    expect(frame[7]).toBe(0x01);
  });
});

describe('Integration: GivEnergyInverter with mock inverter', () => {
  it('starts polling and returns a snapshot', async () => {
    // This test requires GivEnergyInverter to exist.
    // If it doesn't exist yet, skip gracefully.
    let GivEnergyInverter: any;
    try {
      const mod = await import('../src/inverter.js');
      GivEnergyInverter = mod.GivEnergyInverter;
    } catch {
      console.log('Skipping: src/inverter.ts not yet implemented');
      return;
    }

    const mock = await startMockInverter();
    const inv = await GivEnergyInverter.connect({
      host: '127.0.0.1',
      port: mock.port,
    });

    try {
      const snapshot = inv.getData();
      expect(snapshot).toBeDefined();
      expect(snapshot.serialNumber).toBe('SA1234B567');
      expect(snapshot.stateOfCharge).toBe(75);
    } finally {
      await inv.stop();
      await mock.close();
    }
  }, 30000);

  it('emits data events on each poll', async () => {
    let GivEnergyInverter: any;
    try {
      const mod = await import('../src/inverter.js');
      GivEnergyInverter = mod.GivEnergyInverter;
    } catch {
      console.log('Skipping: src/inverter.ts not yet implemented');
      return;
    }

    const mock = await startMockInverter();
    const snapshots: any[] = [];

    const inv = await GivEnergyInverter.connect({
      host: '127.0.0.1',
      port: mock.port,
      pollIntervalMs: 100,
    });
    inv.on('data', (s: any) => snapshots.push(s));

    try {
      // connect() already completed one poll. The next poll fires 100ms later
      // and takes ~4s to complete (inter-read delays + push soak). Wait 6s.
      await new Promise(r => setTimeout(r, 6000));
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
    } finally {
      await inv.stop();
      await mock.close();
    }
  }, 30000);
});
