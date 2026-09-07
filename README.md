# Telegram Bot for Cursor

Installable [Cursor plugin](https://cursor.com/docs/plugins) that lets Agent / Grok send Telegram messages (and a few related Bot API actions) through a local **MCP** server.

v1 talks to Telegram only via the official [HTTP Bot API](https://core.telegram.org/bots/api). It does **not** log into a personal account, use MTProto, or run a userbot.

## What it does

After you create a bot with [@BotFather](https://t.me/BotFather) and set `TELEGRAM_BOT_TOKEN` in Cursor, the agent can:

| MCP tool | Telegram method | Purpose |
| --- | --- | --- |
| `send_message` | `sendMessage` | Send text to a `chat_id` or public `@username` (optional `parse_mode`) |
| `get_me` | `getMe` | Confirm the token works and show bot username |
| `get_updates` | `getUpdates` | Debug / inspect recent updates (optional) |
| `list_recent_chats` | derived from `getUpdates` | Best-effort recent chat list (see limitation below) |

Skills shipped with the plugin:

- **send-telegram-message** — resolve a chat, confirm with you, then send
- **telegram-bot-setup** — BotFather, Plugins → Configure, smoke-test

## Install

### Cursor Marketplace (when listed)

1. Open **Customize** → search **telegram-bot**, or visit [cursor.com/marketplace](https://cursor.com/marketplace).
2. Install the plugin.
3. **Plugins → Configure** → set `TELEGRAM_BOT_TOKEN`.

### From this repository

1. Push/host this public repo (already the case if you cloned [Lotus015/cursor-telegram-plugin](https://github.com/Lotus015/cursor-telegram-plugin)).
2. Submit the repo at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish), and/or list it on [cursor.directory](https://cursor.directory).
3. Until it is listed, install locally:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /path/to/cursor-telegram-plugin ~/.cursor/plugins/local/telegram-bot
```

Reload the window (**Developer: Reload Window**). Team / Enterprise admins may need to allow local plugin imports.

## Configure

1. In Telegram, open [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. In Cursor: **Plugins → Configure** on this plugin → paste the token into `TELEGRAM_BOT_TOKEN`.
3. Open a DM with your bot and tap **Start** (`/start`). Bots cannot message you first.

The plugin declares the variable in `.cursor-plugin/plugin.json` and substitutes `${TELEGRAM_BOT_TOKEN}` in `mcp.json`. The repo never contains a real token.

## Example prompts

- “Verify my Telegram bot with `get_me`. Do not print the token.”
- “I just /start’ed the bot. List recent chats, then send ‘hello from Cursor’ to my DM after I confirm.”
- “Send this release note to `@mychannel` as HTML after I confirm the exact text.”
- “Walk me through BotFather and Plugins → Configure so this plugin can send messages.”

## How to test `send_message`

You need a bot token and a `chat_id` the bot is allowed to talk to.

1. `/start` the bot in Telegram (or add it to a group/channel).
2. Set `TELEGRAM_BOT_TOKEN` in Plugins → Configure (or export it in your shell for a manual run).
3. In Agent chat, ask it to call `get_me`, then `list_recent_chats`, then `send_message` to your `chat_id`.
4. Optional CLI check (token stays in the environment):

```bash
export TELEGRAM_BOT_TOKEN="…"   # local shell only
node packages/mcp-server/dist/index.js   # MCP stdio server; leave running for Inspector

curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H 'Content-Type: application/json' \
  -d '{"chat_id": YOUR_CHAT_ID, "text": "hello from curl"}'
```

Automated tests in this repo mock Telegram’s HTTP API (no live token required). Node.js 20+ is required to run the bundled MCP server.

```bash
npm install --prefix packages/mcp-server
npm test --prefix packages/mcp-server
npm run build --prefix packages/mcp-server
npm run validate
```

## Chat list limitation

The Bot API **cannot** list every chat a bot belongs to. There is no user-style dialog list.

`list_recent_chats` inspects recent `getUpdates` payloads and returns unique chats from those events. If nothing shows up:

- The user has not messaged / `/start`ed the bot
- The group has not produced a recent update
- A **webhook** is set (then `getUpdates` fails until it is deleted)

Address public channels/groups as `@username`. Private users require a numeric `chat_id` after they contact the bot.

## Security

- **The token is a secret.** Anyone with it can send as your bot, read updates, and change bot settings. Set it only in Plugins → Configure. Never commit it, never paste it into chat, never put it in `mcp.json`.
- The MCP server redacts token-shaped strings from error text and does not log the token.
- The bot can only talk to chats it is allowed to: DMs after `/start`, groups it was added to, channels where it can post.
- Confirm destination and message text before `send_message` for real chats.
- This plugin does not request Telegram user-account (MTProto) credentials.

## Why a bundled local MCP server

Public Bot API MCP packages exist (for example `@node2flow/telegram-bot-mcp` and `telegram-api-mcp` on npm). They are real packages, but they are either very large (dozens to 100+ methods, including moderation/webhooks) or not a tight marketplace fit.

This plugin ships a small first-party stdio server:

- Tools match v1 (`send_message`, `get_me`, `get_updates`, `list_recent_chats`)
- Official Bot API only (safer to review than a userbot)
- `node` runs a committed esbuild bundle under `packages/mcp-server/dist` (no extra `npx` package at runtime)

Rebuild after changing server source:

```bash
npm install --prefix packages/mcp-server
npm run build --prefix packages/mcp-server
```

`mcp.json` launches:

```json
{
  "command": "node",
  "args": ["${PLUGIN_ROOT}/packages/mcp-server/dist/index.js"],
  "env": { "TELEGRAM_BOT_TOKEN": "${TELEGRAM_BOT_TOKEN}" }
}
```

## Marketplace submission

This repo is a **single Cursor Plugin** (not a multi-plugin marketplace.json repo).

Checklist from [Cursor plugins reference](https://cursor.com/docs/reference/plugins):

- [x] `.cursor-plugin/plugin.json` with kebab-case `name` `telegram-bot`
- [x] Description, version `0.1.0`, MIT license, keywords
- [x] `variables` JSON Schema for `TELEGRAM_BOT_TOKEN` (required string)
- [x] `mcp.json` uses `${TELEGRAM_BOT_TOKEN}` only
- [x] Skills with YAML frontmatter
- [x] Logo at `assets/logo.svg`
- [x] README + LICENSE
- [x] Public GitHub repository

Submit: [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) with this repository URL. Community listing: [cursor.directory](https://cursor.directory).

## Layout

```text
.
├── .cursor-plugin/plugin.json
├── mcp.json
├── skills/
│   ├── send-telegram-message/SKILL.md
│   └── telegram-bot-setup/SKILL.md
├── assets/logo.svg
├── packages/mcp-server/     # TypeScript MCP server + dist bundle
├── LICENSE
└── README.md
```

## License

[MIT](LICENSE) © Lotus / Lotus015 ([GitHub](https://github.com/Lotus015))
