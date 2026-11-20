import { describe, expect, it } from 'vitest';
import { buildStatus } from '../../src/snapshot/status.js';
import {
  capture,
  contextFor,
  INVERTER_CAPTURES,
  reference,
  registersOf,
  singlePhaseContextFor,
  threePhaseContextFor,
} from '../helpers/snapshot-fixtures.js';

describe('buildStatus on the Gen3 reference unit', () => {
  const registers = reference();
  const status = buildStatus(registers, singlePhaseContextFor(registers));

  it('decodes status, charge status and system mode', () => {
    expect(status).toMatchObject({
      inverterStatus: 'normal',
      chargeStatus: 'charging',
      systemMode: 1,
      faultCode: '0000',
      warningCode: '0000',
      faults: [],
      batteryWarnings: [],
      countdownSeconds: 0,
      hoursOfOperation: 16348,
    });
  });

  it('reads the clock from HR 35–40 with the year offset from 2000', () => {
    const time = status.systemTime;
    expect([time.getFullYear(), time.getMonth() + 1, time.getDate()]).toEqual([2026, 11, 19]);
    expect([time.getHours(), time.getMinutes(), time.getSeconds()]).toEqual([22, 27, 58]);
  });
});

describe('buildStatus quirks', () => {
  const singlePhase = (input: Record<number, number>, holding: Record<number, number> = {}) => {
    const registers = registersOf({ 0: 0x2001, 21: 316, 35: 26, 36: 1, 37: 2, 38: 3, 39: 4, 40: 5, ...holding }, input);
    return buildStatus(registers, singlePhaseContextFor(registers));
  };

  it('decodes battery warnings from IR 57, not IR 56 (an old GivTCP bug)', () => {
    // IR 56 is the battery temperature: 0x00ff would decode as eight warnings if read by mistake.
    expect(singlePhase({ 56: 0x00ff, 57: 0 }).batteryWarnings).toEqual([]);
    expect(singlePhase({ 57: 1 << 4 }).batteryWarnings).toEqual(['BMS under-voltage']);
  });

  it('formats the IR 39/40 fault and warning words as 4 lowercase hex digits', () => {
    const status = singlePhase({ 39: 0xab, 40: 0x1f00 });
    expect(status.faultCode).toBe('00ab');
    expect(status.warningCode).toBe('1f00');
  });

  it('decodes the HR 223/224 fault word into messages', () => {
    expect(singlePhase({}, { 224: 1 << 11 }).faults).toEqual(['Hall Sensor Fault']);
  });

  it('maps known status codes and keeps the rest as "unknown"', () => {
    expect(singlePhase({ 0: 0 }).inverterStatus).toBe('waiting');
    expect(singlePhase({ 0: 3 }).inverterStatus).toBe('fault');
    expect(singlePhase({ 0: 4 }).inverterStatus).toBe('updating');
    expect(singlePhase({ 0: 9 }).inverterStatus).toBe('unknown');
    expect(singlePhase({}).inverterStatus).toBe('unknown');
  });

  it('maps charge status 0/2/3/5 and leaves it out when IR 14 is unread', () => {
    expect(singlePhase({ 14: 0 }).chargeStatus).toBe('idle');
    expect(singlePhase({ 14: 3 }).chargeStatus).toBe('finishing');
    expect(singlePhase({ 14: 5 }).chargeStatus).toBe('discharging');
    expect(singlePhase({ 14: 1 }).chargeStatus).toBe('unknown');
    expect(singlePhase({})).not.toHaveProperty('chargeStatus');
  });

  it('leaves out hours of operation over 100 years, as the external library does', () => {
    // The HV Gen3 capture reads IR 47 = 11034 and IR 48 = 0, which is 723 million hours.
    expect(singlePhase({ 47: 11034, 48: 0 })).not.toHaveProperty('hoursOfOperation');
    expect(singlePhase({ 47: 0, 48: 36316 }).hoursOfOperation).toBe(36316);
  });

  it('leaves out hours of operation unless both halves (IR 47 and IR 48) were read, rather than zero-fill', () => {
    // An unread high word would otherwise read as 0 and turn a partial read into a plausible value.
    expect(singlePhase({ 48: 36316 })).not.toHaveProperty('hoursOfOperation');
    expect(singlePhase({ 47: 0 })).not.toHaveProperty('hoursOfOperation');
    expect(singlePhase({})).not.toHaveProperty('hoursOfOperation');
  });

  it('falls back to the previous snapshot clock when HR 35–40 are invalid', () => {
    const previousTime = new Date(2026, 0, 1, 12, 0, 0);
    const registers = registersOf({ 0: 0x2001, 21: 316, 35: 0, 36: 0, 37: 0 });
    const previous = { status: { systemTime: previousTime } } as never;
    expect(buildStatus(registers, { ...singlePhaseContextFor(registers), previous }).systemTime).toBe(previousTime);
  });
});

describe('buildStatus on three-phase', () => {
  const registers = capture('hybrid_3ph.log');
  const status = buildStatus(registers, threePhaseContextFor(registers));

  it('reads IR 1075/1076/1124 instead of IR 0/49', () => {
    expect(registers.input.get(0)).toBe(0); // IR 0 reads "waiting" on three-phase
    expect(status).toMatchObject({
      inverterStatus: 'normal',
      systemMode: 'grid_tied',
      dcStatus: 'normal',
      faults: [],
      startDelayTime: 0,
    });
    expect(status).not.toHaveProperty('batteryWarnings');
  });

  it('decodes fault words IR 1300–1307', () => {
    const faulty = { ...registers, input: new Map(registers.input).set(1303, 1 << 9) };
    expect(buildStatus(faulty, threePhaseContextFor(faulty)).faults).toEqual(['BMS comm fault']);
  });

  it('reads system mode 0 as offline', () => {
    const offline = { ...registers, input: new Map(registers.input).set(1075, 0) };
    expect(buildStatus(offline, threePhaseContextFor(offline)).systemMode).toBe('offline');
  });
});

describe.each(INVERTER_CAPTURES)('buildStatus on capture $name', ({ name, inject }) => {
  it('decodes without throwing and gives plausible values', () => {
    const registers = capture(name, inject);
    const status = buildStatus(registers, contextFor(registers));
    expect(status.inverterStatus).not.toBe('unknown');
    expect(status.faults).toEqual([]);
    expect(status.systemTime).toBeInstanceOf(Date);
    if ('hoursOfOperation' in status && status.hoursOfOperation !== undefined) {
      expect(status.hoursOfOperation).toBeLessThan(876_000);
    }
  });
});
