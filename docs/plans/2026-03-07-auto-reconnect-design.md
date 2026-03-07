# Auto-Reconnect with Exponential Backoff

GitHub issue: https://github.com/jak/givenergy-modbus/issues/2

## Problem

When the TCP connection to the inverter is lost, the library emits a `lost` event after 10 consecutive poll failures but does not attempt to reconnect. For 24/7 home automation use cases, this means automations silently stop working.

## Design Decisions

- **Reconnection lives in PollManager** — it already tracks `_failCount` and owns the poll lifecycle. Client stays a simple TCP pipe.
- **Trigger on sustained failure, not socket close** — the inverter drops connections transiently during push mode. Reacting to every socket close would cause unnecessary reconnect churn. The existing 10-failure threshold (~2.5 minutes at 15s polls) confirms a real outage.
- **Retry forever** — for always-on use cases, the inverter will eventually come back. Backoff caps at 5 minutes so retries are infrequent. No max attempt limit.
- **No jitter** — single client (maybe 2-3 total), no thundering herd concern.

## Options API

Added to `PollManagerOptions` and surfaced through `GivEnergyInverterOptions`:

```typescript
autoReconnect?: boolean;            // default: true
reconnectBackoffMs?: number;        // initial backoff, default 5000
reconnectMaxBackoffMs?: number;     // cap, default 300000 (5min)
```

## State Machine

```
polling -> 10 consecutive failures -> emit 'lost'
  |-- autoReconnect=false: stop (current behavior)
  +-- autoReconnect=true: enter reconnect loop
       -> stop poll timer
       -> close client
       -> emit 'reconnecting' (attempt, nextRetryMs)
       -> wait backoff
       -> try client.connect() + poll
       |-- success: emit 'reconnected', resume polling, reset backoff & failCount
       +-- failure: double backoff (capped), repeat
```

## Events

| Event | Payload | When |
|-------|---------|------|
| `reconnecting` | `(attempt: number, nextRetryMs: number)` | Before each retry wait |
| `reconnected` | none | After successful reconnection + first poll |
| `lost` | `(err: Error)` | Once, when entering reconnect mode (backward compat) |

## Key Details

- During reconnect, the poll timer is cleared (no polls while disconnected)
- `stop()` cancels any in-progress reconnect attempt via an abort flag
- `getData()` continues returning the last cached snapshot during reconnect (stale but available)
- Backoff resets to initial value after successful reconnection
- Client reconnection is done by calling `close()` then `connect()` to fully reset the socket

## Changes Required

1. **`PollManagerOptions`** — add `autoReconnect`, `reconnectBackoffMs`, `reconnectMaxBackoffMs`
2. **`PollManager._handlePollResult`** — when `_failCount` hits 10 and `autoReconnect` is true, enter reconnect loop instead of just emitting `lost`
3. **`PollManager._reconnectLoop`** — new method implementing backoff + retry
4. **`PollManager.stop`** — set abort flag to break out of reconnect loop
5. **`GivEnergyInverterOptions`** — surface the three new options
6. **`GivEnergyInverter` constructor** — forward `reconnecting` and `reconnected` events
7. **Tests** — cover reconnection scenarios (success after N retries, backoff doubling, stop during reconnect, autoReconnect=false preserves old behavior)
