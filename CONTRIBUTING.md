# Contributing to EchoTrace

Thanks for helping!

## Quickstart

```bash
npm install
npm run dev -- init
npm run dev -- post "hello"
```

## Security checklist (must pass)
- [ ] No secrets committed (`nsec`, `~/.agentlog`, `db.sqlite`, tokens)
- [ ] Received events are signature-verified before caching
- [ ] Relay/network failures do not crash the process
- [ ] Dependencies are justified and minimal

## PR rules
- Small PRs only (focused changes).
- Include a short **Threat/Security impact** section.
- Include how you tested (commands + expected output).

## Local state
EchoTrace stores state under `~/.agentlog/`. Do not commit it.
