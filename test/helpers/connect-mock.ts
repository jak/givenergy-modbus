/**
 * Connect a real `GivEnergyInverter` to a mock inverter, with short timeouts and no retries so a
 * full poll takes about a second. Call `disconnectAll()` in `afterEach`.
 */
import { GivEnergyInverter, SinglePhaseInverter, ThreePhaseInverter } from '../../src/inverter.js';
import type { PollTiming } from '../../src/poll-manager.js';
import { startMockInverter, type MockDevice, type MockRequest } from './mock-inverter.js';

export const FAST_TIMING: Partial<PollTiming> = { requestTimeoutMs: 60, requestRetries: 0, scanRetries: 1, retryDelayMs: 0, interReadDelayMs: 0, pushSoakMs: 30 };

const cleanup: Array<() => Promise<void>> = [];

export async function disconnectAll(): Promise<void> {
  for (const step of cleanup.splice(0).reverse()) await step();
}

/** Connect, then clear `mock.requests`, so tests see only what the inverter is asked afterwards. */
export async function connectToMock(devices: Map<number, MockDevice>, silent?: (request: MockRequest) => boolean) {
  const mock = await startMockInverter({ devices, silent });
  cleanup.push(() => mock.close());
  const inverter = await GivEnergyInverter.connect({ host: '127.0.0.1', port: mock.port, autoReconnect: false, timing: FAST_TIMING });
  cleanup.push(() => inverter.stop());
  mock.requests.length = 0;
  return { mock, inverter };
}

export async function connectSinglePhase(devices: Map<number, MockDevice>, silent?: (request: MockRequest) => boolean) {
  const { mock, inverter } = await connectToMock(devices, silent);
  if (!(inverter instanceof SinglePhaseInverter)) throw new Error(`expected single-phase, got ${inverter.layout}`);
  return { mock, inverter };
}

export async function connectThreePhase(devices: Map<number, MockDevice>) {
  const { mock, inverter } = await connectToMock(devices);
  if (!(inverter instanceof ThreePhaseInverter)) throw new Error(`expected three-phase, got ${inverter.layout}`);
  return { mock, inverter };
}

/** Register a mock for cleanup that the test starts itself. */
export function onDisconnect(step: () => Promise<void>): void {
  cleanup.push(step);
}
