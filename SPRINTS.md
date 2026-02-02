# EchoTrace Sprints

EchoTrace uses short, stability-focused sprints.

## Sprint 0001 — Stability & Agent Watch Mode (2026-02-03 → 2026-02-09)

**Goal:** One agent can run EchoTrace for 24h with no crashes, minimal manual babysitting.

### Must-have (P0)
1. **watch mode**: `echotrace watch`
   - Subscribe feed for follows
   - Run `sync` loop periodically (e.g. every 60s)
   - Reconnect/backoff on relay errors
   - Graceful shutdown on SIGINT/SIGTERM

2. **publish queue reliability**
   - Ensure relay rejects/timeouts never crash the process
   - Store per-relay error reasons in pending queue

3. **cache_limit enforcement**
   - Enforce `cache_limit` by deleting oldest events beyond limit
   - Keep kinds 0/1/7 only (current scope)

### Should-have (P1)
4. **machine-readable output**
   - `--json` flag on core commands to help agents parse output

5. **smoke test script**
   - Script to run 2 local profiles (A/B) and verify: post -> react -> reply

### Nice-to-have (P2)
6. **config validation**
   - Validate relays as `wss://` by default
   - Warn on `ws://` usage

### Definition of Done
- `npm run build` passes
- `watch` runs for 1h locally without unhandled exceptions
- Offline publish → queued → `sync` publishes when relays available
- No secrets ever written to logs or committed
