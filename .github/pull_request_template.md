## What

(What does this change do?)

## Why

(Why is it needed?)

## How tested

Commands you ran + results:

```bash
npm install
npm run build
npm run dev -- init
```

## Security / Threat impact (required)
- Does this touch keys/identity, networking/relays, signature verification, SQLite, or dependency changes?
- Any new attack surface?

## Checklist
- [ ] No secrets or local state committed (nsec, ~/.agentlog, db.sqlite, tokens)
- [ ] Signature verification preserved for all inbound events
- [ ] Errors handled without crashing (especially relay publish)
- [ ] Minimal dependencies / justified changes
