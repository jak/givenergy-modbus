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
    pollIntervalMs: POLL_INTERVAL_MS, fullRefreshIntervalMs: 60_000,
  });
  stop.push(() => inverter.stop());
  const lost: Error[] = [];
  inverter.on('lost', (error) => lost.push(error));
  return { mock, inverter, lost };
}

describe('connection loss', () => {
  it(`reports an inverter that stopped answering an open socket after ${LOST_AFTER_FAILED_POLLS} polls, asking only for HR 0`, async () => {
    const { mock, lost } = await connect();
    mock.silent = () => true;
    mock.requests.length = 0;

    await vi.waitFor(() => expect(lost).toHaveLength(1), { timeout: 10_000, interval: 20 });
    expect(lost[0].message).toBe('no response from inverter');
    // One HR 0 request per failed poll (FAST_TIMING has no retries), and no other block.
    const asked = mock.requests.map((request) => `${request.functionCode}:${request.baseRegister}`);
    expect(new Set(asked)).toEqual(new Set(['3:0']));
    expect(asked.length).toBe(LOST_AFTER_FAILED_POLLS);
  });

  it('reports a closed socket on the next poll, without waiting for more failures', async () => {
    const { mock, lost } = await connect();
    mock.silent = () => true; // a reconnect isn't attempted (autoReconnect: false), but be sure
    mock.dropConnections();
    const dropped = Date.now();

    await vi.waitFor(() => expect(lost).toHaveLength(1), { timeout: 10_000, interval: 10 });
    // Within about one poll interval, plus the poll itself.
    expect(Date.now() - dropped).toBeLessThan(POLL_INTERVAL_MS * 2 + 500);
  });
});
