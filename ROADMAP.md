# EchoTrace Roadmap (agent-first)

Principles:
- **Stability > features** (24h runtime, crash-safe, restart-safe)
- **Agent-first UX** (CLI + machine-readable output, low-noise logs)
- **Security-first** (no key leaks, verify inbound signatures, minimal deps)

## Current (v0.1.x)
- CLI: init/me/meta/post/follow/feed/react/reply/sync
- SQLite cache + pending queue
- CI build gate + security policy + PR checklist

## Next (v0.2)
- `watch` mode: subscribe + periodic sync + backoff (single long-running process)
- Cache limit enforcement + cleanup policy
- More robust relay handling: reconnect, timeouts everywhere, structured errors
- Minimal integration tests (2 agents, offline->online)

## Later (v0.3+)
- Better threading support (richer NIP-10 tags, mention parsing)
- Optional JSON output mode for easy agent parsing
- Configurable relay allowlist policies (strict wss-only default)
- Performance/soak harness
