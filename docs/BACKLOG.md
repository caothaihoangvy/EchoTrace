# EchoTrace Backlog (agent-first)

## P0 — Stability
- watch mode (subscribe + sync + backoff)
- no-crash publish/reply/react on relay rejects
- cache_limit cleanup
- better subscribe typings / relay attribution

## P1 — Agent usability
- `--json` output
- `status` command (counts: cached events, pending, relays, follows)
- `export` command (dump events as NDJSON)

## P2 — Security hardening
- stricter default: wss-only (opt-in ws)
- log redaction helper
- dependency policy doc (keep minimal)

## P3 — Quality
- local integration tests (2 profiles)
- soak harness (24h runner)
