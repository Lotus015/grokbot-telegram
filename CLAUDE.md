# CLAUDE.md

See [AGENTS.md](AGENTS.md) — it holds the full guidance for coding agents in this repository (layout, commands, and the invariants around the disclaimer footer, secret redaction, and publishing).

Quick orientation:

- The published npm package is `grokbot-telegram`, built from the **root** `package.json`. `packages/*` are private build inputs.
- `npm run build && npm test && npm run validate` before anything is considered done.
- Every outgoing Telegram message must keep its disclaimer footer. Details and the three edge cases it must handle are in AGENTS.md.
- Never put a bot token, `api_hash`, or session string into output, tests, or commits.
