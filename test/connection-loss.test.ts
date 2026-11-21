// How quickly a lost inverter is reported. Quirk: the real dongle, with the computer's Wi-Fi
// turned off, took 3.5 minutes to report 'lost' (about a minute for macOS to fail the socket,
// then 10 failed polls). An open socket the inverter stopped answering took about 23 minutes:
// each poll waited out ~40 s of retries on every block.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GivEnergyInverter } from '../src/inverter.js';
import { LOST_AFTER_FAILED_POLLS } from '../src/poll-manager.js';
import { reference } from './helpers/snapshot-fixtures.js';
import { devicesOf, startMockInverter, type MockInverter } from './helpers/mock-inverter.js';
import { FAST_TIMING } from './helpers/connect-mock.js';

const POLL_INTERVAL_MS = 100;
let stop: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const step of stop.reverse()) await step();
  stop = [];
});

async function connect(): Promise<{ mock: MockInverter; inverter: GivEnergyInverter; lost: Error[] }> {
  const mock = await startMockInverter({ devices: devicesOf(reference()) });
  stop.push(() => mock.close());
  const inverter = await GivEnergyInverter.connect({
    host: '127.0.0.1', port: mock.port, autoReconnect: false, timing: FAST_TIMING,
    pollIntervalMs: POLL_INTERVAL_MS,
  });
  stop.push(() => inverter.stop());
  const lost: Error[] = [];
  inverter.on('lost', (error) => lost.push(error));
  return { mock, inverter, lost };
}

describe('connection loss', () => {
  it(`reports an inverter that stopped answering an open socket after ${LOST_AFTER_FAILED_POLLS} polls, asking only for HR 0`, async () => {
    const { mock, inverter, lost } = await connect();
    mock.silent = () => true;
    mock.requests.length = 0;
    // Polling goes on after 'lost' (autoReconnect is off), so take the requests as 'lost' fires.
    let askedBeforeLost: string[] = [];
    inverter.once('lost', () => {
      askedBeforeLost = mock.requests.map((request) => `${request.functionCode}:${request.baseRegister}`);
    });

    await vi.waitFor(() => expect(lost.length).toBeGreaterThanOrEqual(1), { timeout: 10_000, interval: 20 });
    expect(lost[0].message).toBe('no response from inverter');
    // One HR 0 request per failed poll (FAST_TIMING has no retries), and no other block.
    const asked = askedBeforeLost;
    expect(new Set(asked)).toEqual(new Set(['3:0']));
    expect(asked.length).toBe(LOST_AFTER_FAILED_POLLS);
  });

  it('reports a closed socket on the next poll, without waiting for more failures', async () => {
    const { mock, inverter, lost } = await connect();
    mock.silent = () => true;
    let failedPollsAtLost = -1;
    inverter.once('lost', () => { failedPollsAtLost = (inverter as any).pollManager._failCount; });
    mock.dropConnections();

    await vi.waitFor(() => expect(lost.length).toBeGreaterThanOrEqual(1), { timeout: 10_000, interval: 10 });
    expect(failedPollsAtLost).toBe(1);
  });
});
