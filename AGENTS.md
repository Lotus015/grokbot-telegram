# AGENTS.md

Guidance for coding agents working in this repository. Humans: see [README.md](README.md).

## What this repo is

One Cursor plugin **and** one npm package, from the same tree:

- **Cursor plugin** — `.cursor-plugin/plugin.json` + `mcp.json` + `skills/`
- **npm package** — `grokbot-telegram`, published from the **root** `package.json`

It ships two stdio MCP servers:

| Server | Source | Identity | Protocol |
| --- | --- | --- | --- |
| `telegram-bot` | `packages/mcp-server` | your @BotFather bot | HTTP Bot API |
| `telegram-user` | `packages/mcp-user-server` | your personal account | MTProto via `teleproto` |

## Layout

```
package.json                  # the PUBLISHED package (name: grokbot-telegram)
src/cli.js                    # bin dispatcher: bot | user | login
dist/                         # built, gitignored, published
scripts/build-dist.mjs        # collects package bundles into root dist/
scripts/validate-plugin.mjs   # plugin + manifest invariants
packages/mcp-server/          # Bot API server (private, source only)
packages/mcp-user-server/     # MTProto server (private, source only)
skills/                       # agent-facing skill docs, shipped in the tarball
```

`packages/*` are **not** published. They are build inputs. Only the root package goes to npm.

## Commands

```bash
npm run build      # per-package esbuild bundles, then collect into root dist/
npm test           # both packages, node:test, no network
npm run typecheck  # tsc --noEmit in both packages
npm run validate   # manifest + wiring invariants
```

Dependencies live per package (`npm install --prefix packages/mcp-server`, same for the other). The root has no `node_modules`; it only orchestrates.

## Invariants — do not break these silently

**A failing behaviour must fail a test.** Never pin a bug into a green test to make the suite pass. Write the test that fails, then fix the code. If you change intended behaviour, update the assertion to the *new intended* value — do not delete the assertion.

**Every outgoing message carries a disclaimer footer.** Both `send_message` tools call `applyDisclaimer` before sending. This is a trust feature, not a nicety: recipients must be able to tell an agent sent it. If you touch send paths, keep the footer. It is configurable through `TELEGRAM_DISCLAIMER` but defaults to on.

Three things the footer logic must keep doing (each has tests):

1. Escape itself for `parse_mode`. An unescaped `.` or `-` makes Telegram reject the whole message in MarkdownV2.
2. Count against the 4096-character limit, and **refuse** the send when it overflows — never truncate the caller's text, never drop the footer to make room.
3. Treat a literal `${TELEGRAM_DISCLAIMER}` as unset. Cursor passes unsubstituted placeholders through verbatim.

**Never log or echo secrets.** Bot tokens, `api_hash`, and session strings are redacted through `redact.ts` in each package. Errors go out via `safeErrorMessage`. A session string is full account access — treat it like a password.

**Version numbers move together.** Root `package.json`, `.cursor-plugin/plugin.json`, both `packages/*/package.json`, and the `VERSION` constant in both `src/server.ts` files. `npm run validate` fails if the root and plugin manifests disagree.

## Publishing

```bash
npm login          # interactive, a human has to do this
npm publish        # from the repo root
```

`prepublishOnly` runs build + test + validate, so a stale `dist/` cannot ship.

Gotcha worth remembering: the `bin` path must be `"dist/cli.js"`, **not** `"./dist/cli.js"`. npm silently strips the bin entry for the `./` form, and the published package ends up with no executable — `npx grokbot-telegram` then does nothing. Always check `npm publish --dry-run` output for `npm warn publish`.

## Adding a tool

1. Implement in `packages/<server>/src/server.ts` via `server.registerTool`.
2. Prefix the description with `[Bot API]` or `[User account]` — both servers expose `send_message` and `get_me`, and the prefix is how a model tells them apart.
3. Set `annotations` honestly (`readOnlyHint`, `destructiveHint`).
4. Add a test in `packages/<server>/test/server.test.ts`. Tests mock Telegram; nothing hits the network.
5. If the tool sends anything, route the text through `applyDisclaimer`.
6. Update the tool table in `README.md`, and the relevant `skills/*/SKILL.md` if agent behaviour changes.
