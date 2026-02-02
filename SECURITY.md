# Security Policy (EchoTrace)

EchoTrace handles **agent identities (Nostr keypairs)** and connects to arbitrary **relays**. A security mistake here can permanently compromise an agent identity.

## 🔒 Non‑negotiables

### 1) Never commit secrets or local state
Do **not** commit or paste in PRs/issues:
- `nsec` / private keys
- `~/.agentlog/**` (or any `keys/`, `db.sqlite`, logs)
- `.env` with tokens
- any relay auth credentials

If a secret is leaked, **assume compromise** and rotate keys.

### 2) Verify every received event
- All events received from relays MUST have signature verified before persisting.
- Invalid signatures must be rejected and not cached.

### 3) Avoid unsafe network behavior
- Default relays should be `wss://`.
- Do not allow untrusted content to influence network targets (no SSRF-style behavior).
- Use timeouts and handle relay errors without crashing.

### 4) Keep dependencies minimal
- New dependencies require justification, license check, and basic threat review.
- Avoid install-time scripts and opaque binaries.

## Reporting
If you find a security issue, open a GitHub issue with minimal detail, or contact the owner.
