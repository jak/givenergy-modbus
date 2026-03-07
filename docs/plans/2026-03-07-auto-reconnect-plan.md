# Auto-Reconnect Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automatic reconnection with exponential backoff to PollManager so the library recovers from connection loss without consumer intervention.

**Architecture:** Reconnection lives in PollManager. After 10 consecutive poll failures, PollManager stops the poll timer, closes the client, and enters a reconnect loop with exponential backoff (5s initial, doubling to 5min cap). On success it resumes normal polling.

**Tech Stack:** TypeScript, Node.js EventEmitter, vitest

**Design doc:** `docs/plans/2026-03-07-auto-reconnect-design.md`

---

### Task 1: Add reconnect options to PollManagerOptions

**Files:**
- Modify: `src/poll-manager.ts:12-17`

**Step 1: Add the three new optional fields to PollManagerOptions**

```typescript
export interface PollManagerOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;        // default 15000 (15s partial)
  fullRefreshIntervalMs?: number;  // default 60000 (60s full)
  autoReconnect?: boolean;         // default true
  reconnectBackoffMs?: number;     // initial backoff, default 5000
  reconnectMaxBackoffMs?: number;  // max backoff cap, default 300000 (5min)
}
```

**Step 2: Default the new options in the constructor**

In `src/poll-manager.ts`, update the constructor's `this.options` assignment to include:

```typescript
autoReconnect: options.autoReconnect ?? true,
reconnectBackoffMs: options.reconnectBackoffMs ?? 5_000,
reconnectMaxBackoffMs: options.reconnectMaxBackoffMs ?? 300_000,
```

**Step 3: Run tests**

Run: `npx vitest run`
Expected: All existing tests pass (no behavior change yet).

**Step 4: Commit**

```
feat: add reconnect options to PollManagerOptions
```

---

### Task 2: Implement reconnect loop in PollManager

**Files:**
- Modify: `src/poll-manager.ts`

**Step 1: Add reconnect state fields**

Add these private fields to `PollManager`:

```typescript
private _reconnecting = false;
private _reconnectAbort = false;
```

**Step 2: Implement `_reconnectLoop` method**

Add after `_handlePollResult`:

```typescript
private async _reconnectLoop(): Promise<void> {
  this._reconnecting = true;
  let attempt = 0;
  let backoff = this.options.reconnectBackoffMs;

  while (!this._reconnectAbort) {
    attempt++;
    this.emit('reconnecting', attempt, backoff);
    this.emit('debug', `reconnect attempt ${attempt}, waiting ${backoff}ms`);

    await this._delay(backoff);
    if (this._reconnectAbort) break;

    try {
      await this.client.close();
      await this.client.connect();
      // Try a full poll to confirm the connection works
      await this._executePoll(true);

      if (this._cache && this._failCount === 0) {
        this.emit('debug', 'reconnected successfully');
        this.emit('reconnected');
        this._reconnecting = false;
        this._failCount = 0;
        this._pollTimer = setInterval(
          () => this._executePoll(false),
          this.options.pollIntervalMs,
        );
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('debug', `reconnect attempt ${attempt} failed: ${msg}`);
    }

    backoff = Math.min(backoff * 2, this.options.reconnectMaxBackoffMs);
  }

  this._reconnecting = false;
}
```

**Step 3: Modify `_handlePollResult` to trigger reconnect**

Change the `_failCount >= 10` branch:

```typescript
_handlePollResult(snapshot: InverterSnapshot | null, err: Error | null): void {
  if (snapshot) {
    this._failCount = 0;
    this._previousSnapshot = snapshot;
    this._cache = snapshot;
    this.emit('data', snapshot);
  } else {
    this._failCount++;
    if (this._failCount >= 10 && !this._reconnecting) {
      this.emit('lost', err ?? new Error('too many consecutive failures'));
      if (this.options.autoReconnect) {
        // Stop polling and enter reconnect loop
        if (this._pollTimer) {
          clearInterval(this._pollTimer);
          this._pollTimer = null;
        }
        this._reconnectLoop();
      }
    }
  }
}
```

**Step 4: Update `stop()` to abort reconnect**

```typescript
async stop(): Promise<void> {
  this._reconnectAbort = true;
  if (this._pollTimer) {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }
  await this.client.close();
  this._started = false;
  this._reconnecting = false;
}
```

**Step 5: Run tests**

Run: `npx vitest run`
Expected: All existing tests still pass. The `lost` event test still works because `autoReconnect` defaults to true but the reconnect loop runs asynchronously — the `lost` event is emitted synchronously before the loop starts.

Note: The existing test at line 138-147 calls `_handlePollResult` directly with `_failCount = 9`. With autoReconnect defaulting to true, the reconnect loop will fire asynchronously. The test only checks that `lost` was emitted synchronously, so it should still pass. But if it breaks, the fix is to create PollManager with `autoReconnect: false` in that specific test.

**Step 6: Commit**

```
feat: implement reconnect loop with exponential backoff in PollManager
```

---

### Task 3: Surface reconnect options in GivEnergyInverterOptions

**Files:**
- Modify: `src/inverter.ts:7-11`
- Modify: `src/inverter.ts:32-37` (the `connect` factory)

**Step 1: Add options to GivEnergyInverterOptions**

```typescript
export interface GivEnergyInverterOptions {
  host: string;
  port?: number;
  pollIntervalMs?: number;
  autoReconnect?: boolean;
  reconnectBackoffMs?: number;
  reconnectMaxBackoffMs?: number;
}
```

**Step 2: Forward options to PollManager in `connect()`**

```typescript
static async connect(options: GivEnergyInverterOptions): Promise<GivEnergyInverter> {
  const pollManager = new PollManager({
    host: options.host,
    port: options.port,
    pollIntervalMs: options.pollIntervalMs,
    autoReconnect: options.autoReconnect,
    reconnectBackoffMs: options.reconnectBackoffMs,
    reconnectMaxBackoffMs: options.reconnectMaxBackoffMs,
  });
```

**Step 3: Forward `reconnecting` and `reconnected` events in the constructor**

Add to the constructor after the existing event forwarding:

```typescript
this.pollManager.on('reconnecting', (attempt: number, nextRetryMs: number) =>
  this.emit('reconnecting', attempt, nextRetryMs),
);
this.pollManager.on('reconnected', () => this.emit('reconnected'));
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 5: Commit**

```
feat: surface reconnect options in GivEnergyInverterOptions
```

---

### Task 4: Write tests for auto-reconnect

**Files:**
- Modify: `test/poll-manager.test.ts`

**Step 1: Write test — autoReconnect=false preserves old behavior (lost event, no reconnect)**

```typescript
it('does not reconnect when autoReconnect is false', () => {
  const pm = new PollManager({ host: '127.0.0.1', autoReconnect: false });
  const lostEvents: Error[] = [];
  const reconnectingEvents: number[] = [];
  pm.on('lost', (err: Error) => lostEvents.push(err));
  pm.on('reconnecting', (attempt: number) => reconnectingEvents.push(attempt));

  (pm as any)._failCount = 9;
  (pm as any)._handlePollResult(null, new Error('connection lost'));

  expect(lostEvents).toHaveLength(1);
  expect(reconnectingEvents).toHaveLength(0);
});
```

**Step 2: Write test — reconnect loop emits reconnecting events with increasing backoff**

```typescript
it('emits reconnecting events with exponential backoff', async () => {
  const pm = new PollManager({
    host: '127.0.0.1',
    autoReconnect: true,
    reconnectBackoffMs: 10,     // fast for testing
    reconnectMaxBackoffMs: 40,
  });

  const events: Array<{ attempt: number; backoff: number }> = [];
  pm.on('reconnecting', (attempt: number, backoff: number) => {
    events.push({ attempt, backoff });
    // Stop after 4 attempts
    if (attempt >= 4) {
      pm.stop();
    }
  });

  // Mock client.connect to always fail
  (pm as any).client.connect = vi.fn().mockRejectedValue(new Error('refused'));
  (pm as any).client.close = vi.fn().mockResolvedValue(undefined);

  // Trigger reconnect
  (pm as any)._failCount = 9;
  (pm as any)._handlePollResult(null, new Error('connection lost'));

  // Wait for reconnect loop to run through attempts
  await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(4), { timeout: 2000 });

  expect(events[0]).toEqual({ attempt: 1, backoff: 10 });
  expect(events[1]).toEqual({ attempt: 2, backoff: 20 });
  expect(events[2]).toEqual({ attempt: 3, backoff: 40 }); // capped
  expect(events[3]).toEqual({ attempt: 4, backoff: 40 }); // stays capped
});
```

**Step 3: Write test — successful reconnect emits reconnected and resumes polling**

```typescript
it('emits reconnected after successful reconnection', async () => {
  const pm = new PollManager({
    host: '127.0.0.1',
    autoReconnect: true,
    reconnectBackoffMs: 10,
    reconnectMaxBackoffMs: 10,
    pollIntervalMs: 100,
  });

  let reconnected = false;
  pm.on('reconnected', () => { reconnected = true; });

  // Mock client: fail first connect, succeed second
  let connectAttempt = 0;
  (pm as any).client.connect = vi.fn().mockImplementation(async () => {
    connectAttempt++;
    if (connectAttempt < 2) throw new Error('refused');
  });
  (pm as any).client.close = vi.fn().mockResolvedValue(undefined);

  // Mock _executePoll to succeed on reconnect
  const originalExecutePoll = (pm as any)._executePoll.bind(pm);
  (pm as any)._executePoll = vi.fn().mockImplementation(async () => {
    (pm as any)._cache = mockSnapshot;
    (pm as any)._failCount = 0;
    (pm as any)._started = true;
  });

  // Trigger reconnect
  (pm as any)._failCount = 9;
  (pm as any)._handlePollResult(null, new Error('connection lost'));

  await vi.waitFor(() => expect(reconnected).toBe(true), { timeout: 2000 });

  // Poll timer should be restored
  expect((pm as any)._pollTimer).not.toBeNull();

  // Clean up
  await pm.stop();
});
```

**Step 4: Write test — stop() during reconnect aborts the loop**

```typescript
it('stop() aborts an in-progress reconnect loop', async () => {
  const pm = new PollManager({
    host: '127.0.0.1',
    autoReconnect: true,
    reconnectBackoffMs: 50,
    reconnectMaxBackoffMs: 50,
  });

  const events: number[] = [];
  pm.on('reconnecting', (attempt: number) => events.push(attempt));

  (pm as any).client.connect = vi.fn().mockRejectedValue(new Error('refused'));
  (pm as any).client.close = vi.fn().mockResolvedValue(undefined);

  // Trigger reconnect
  (pm as any)._failCount = 9;
  (pm as any)._handlePollResult(null, new Error('connection lost'));

  // Wait for first attempt, then stop
  await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 1000 });
  await pm.stop();

  const countAfterStop = events.length;
  // Wait a bit and confirm no more attempts
  await new Promise(r => setTimeout(r, 200));
  expect(events.length).toBe(countAfterStop);
  expect((pm as any)._reconnecting).toBe(false);
});
```

**Step 5: Write test — backoff resets after successful reconnection**

```typescript
it('resets backoff after successful reconnection', async () => {
  const pm = new PollManager({
    host: '127.0.0.1',
    autoReconnect: true,
    reconnectBackoffMs: 10,
    reconnectMaxBackoffMs: 40,
    pollIntervalMs: 50,
  });

  const allBackoffs: number[] = [];
  pm.on('reconnecting', (_attempt: number, backoff: number) => {
    allBackoffs.push(backoff);
  });

  // Mock client: fail twice, then succeed
  let connectAttempt = 0;
  (pm as any).client.connect = vi.fn().mockImplementation(async () => {
    connectAttempt++;
    if (connectAttempt <= 2) throw new Error('refused');
  });
  (pm as any).client.close = vi.fn().mockResolvedValue(undefined);
  (pm as any)._executePoll = vi.fn().mockImplementation(async () => {
    (pm as any)._cache = mockSnapshot;
    (pm as any)._failCount = 0;
    (pm as any)._started = true;
  });

  // First reconnect cycle
  (pm as any)._failCount = 9;
  (pm as any)._handlePollResult(null, new Error('lost'));

  await vi.waitFor(() => expect((pm as any)._reconnecting).toBe(false), { timeout: 2000 });

  // Backoff should have been 10, 20 (then succeeded on attempt 3)
  expect(allBackoffs[0]).toBe(10);
  expect(allBackoffs[1]).toBe(20);

  await pm.stop();
});
```

**Step 6: Update existing lost event test to use autoReconnect: false**

The existing test "emits lost event after 10 consecutive failures" should explicitly set `autoReconnect: false` so it doesn't trigger the reconnect loop:

```typescript
it('emits lost event after 10 consecutive failures', () => {
  const pm = new PollManager({ host: '127.0.0.1', autoReconnect: false });
  // ... rest unchanged
});
```

**Step 7: Run tests**

Run: `npx vitest run`
Expected: All tests pass including new reconnect tests.

**Step 8: Commit**

```
test: add auto-reconnect test coverage
```

---

### Task 5: Update scripts if needed

**Files:**
- Check: `scripts/monitor.mjs` — this is the long-running script most likely to benefit from reconnect logging

**Step 1: Check if monitor.mjs handles the `lost` event**

Read `scripts/monitor.mjs` and check if it listens for `lost`. If so, add listeners for `reconnecting` and `reconnected` events to log them.

**Step 2: Run build and verify**

Run: `npm run build`
Expected: Clean compile, no errors.

**Step 3: Commit (if changes made)**

```
feat: log reconnect events in monitor script
```
