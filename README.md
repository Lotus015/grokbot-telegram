# Telegram for Cursor

Installable [Cursor plugin](https://cursor.com/docs/plugins) with **two** first-party MCP servers:

| Mode | MCP server | Identity | Protocol |
| --- | --- | --- | --- |
| **Bot** | `telegram-bot` | Your [@BotFather](https://t.me/BotFather) bot | Official [HTTP Bot API](https://core.telegram.org/bots/api) |
| **User account** | `telegram-user` | **Your personal Telegram account** | [MTProto](https://core.telegram.org/mtproto) via [teleproto](https://github.com/sanyok12345/teleproto) (maintained [GramJS](https://github.com/gram-js/gramjs) fork) |

Use one or both. v0.2.0 keeps the v0.1.0 Bot API path and adds user-account login.

This is **not** Bot API–only, and it is **not** user-account–only. Marketplace copy: a Cursor plugin that can send/read Telegram as a bot **and/or** as the logged-in user.

## Which mode should I use?

| Need | Mode |
| --- | --- |
| Notifications, CI alerts, channel posts as `@mybot` | **Bot API** — `TELEGRAM_BOT_TOKEN` |
| “Send this in **my** name”, read my real chats / dialog list | **User account** — `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` + session |
| Both (bot for alerts, account for DMs) | Configure **both** variable sets |

Bot API **cannot** list your personal inbox. User-account mode **can** (`list_dialogs`), because it is logged in as you.

## What you must provide

### Bot API (`telegram-bot`)

1. Create a bot with [@BotFather](https://t.me/BotFather) → `/newbot`.
2. Set **`TELEGRAM_BOT_TOKEN`** in Cursor **Plugins → Configure**.
3. Open a DM with the bot and tap **Start** (`/start`). Bots cannot message you first.

No `api_id` is required for this mode.

### User account (`telegram-user`) — first run

1. Open [https://my.telegram.org/apps](https://my.telegram.org/apps), log in with the **same phone** as the Telegram account you want to use, and create an app.
2. Set **`TELEGRAM_API_ID`** and **`TELEGRAM_API_HASH`** in **Plugins → Configure**.
3. Complete **one-time login** (phone + code, QR / Link Desktop Device, or an existing session string).
4. Persist the session as **`TELEGRAM_SESSION`** and/or the file `~/.cursor-telegram-plugin/user.session` (mode `0600`).

You will be asked for api_id / api_hash / login on first run. A bot token is **not** used for this server.

**The session is full account access.** Treat it like a password. Never commit it.

## Security

### Bot token

Anyone with `TELEGRAM_BOT_TOKEN` can send as that bot, read updates, and change bot settings. Set it only in Plugins → Configure. The bot MCP redacts token-shaped strings from errors.

### User session (stronger warning)

- A GramJS **session string** or session file is equivalent to being logged in on a new device.
- Anyone who has it can **read your chats and send as you**.
- Never commit `TELEGRAM_SESSION`, `api_hash`, `.env`, or `*.session` files.
- After first login, save the session in Plugins → Configure or keep the `0600` session file. Do not leave the string in chat history if you can avoid it.
- Revoke: Telegram → **Settings → Devices** → terminate the unknown session, then delete the session file / clear the variable.
- Automating a user account is a Telegram ToS gray area. Keep sends human-paced. No spam or bulk broadcast.

The repo never contains real tokens, api hashes, or sessions. `mcp.json` only has `${VAR}` placeholders that match the manifest.

## MCP tools

### `telegram-bot` (unchanged Bot API v1)

| Tool | Telegram method | Purpose |
| --- | --- | --- |
| `send_message` | `sendMessage` | Send text as the **bot** (`chat_id` or public `@username`) |
| `get_me` | `getMe` | Confirm the token; bot username |
| `get_updates` | `getUpdates` | Debug recent updates |
| `list_recent_chats` | derived from `getUpdates` | Best-effort recent chats (not a full inbox) |

### `telegram-user` (MTProto)

| Tool | Purpose |
| --- | --- |
| `auth_status` | Credentials + whether the session is authorized |
| `start_login` / `complete_login` | Phone + login code (+ optional 2FA password) |
| `start_qr_login` / `complete_qr_login` | QR / Link Desktop Device (+ optional 2FA) |
| `get_me` | Logged-in **user** (not a bot) |
| `list_dialogs` | Real dialog / inbox list |
| `search_dialogs` | Filter dialogs by title, username, or id |
| `get_messages` | Recent history for a chat |
| `send_message` | Send text **as the user** (`me`, `@username`, or dialog id) |

Both servers expose `send_message` and `get_me`. Prefer the MCP server name (`telegram-bot` vs `telegram-user`). Tool descriptions are prefixed `[Bot API]` or `[User account]`.

## Skills

- **telegram-mode-guide** — when to use bot vs user
- **telegram-bot-setup** — BotFather, `TELEGRAM_BOT_TOKEN`, smoke-test
- **send-telegram-message** — send as the bot; confirm first
- **telegram-user-setup** — my.telegram.org, first login, session persistence
- **send-telegram-user-message** — resolve from the dialog list; confirm first

## Install

### Cursor Marketplace (when listed)

1. Open **Customize** → search **telegram-bot**, or visit [cursor.com/marketplace](https://cursor.com/marketplace).
2. Install the plugin.
3. **Plugins → Configure** → set the variables for the mode(s) you want.

### From this repository

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /path/to/cursor-telegram-plugin ~/.cursor/plugins/local/telegram-bot
```

Reload the window (**Developer: Reload Window**). Team / Enterprise admins may need to allow local plugin imports.

Submit the public repo at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) and/or list it on [cursor.directory](https://cursor.directory).

## Configure

The plugin declares variables in `.cursor-plugin/plugin.json` and substitutes `${VAR}` placeholders in `mcp.json`. None are required in the schema so you can enable only one mode.

| Variable | Mode | Where to get it |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot | [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_API_ID` | User | [my.telegram.org/apps](https://my.telegram.org/apps) |
| `TELEGRAM_API_HASH` | User | [my.telegram.org/apps](https://my.telegram.org/apps) |
| `TELEGRAM_SESSION` | User | Returned after first login (optional if the session file exists) |

Optional env (not a marketplace variable): `TELEGRAM_SESSION_PATH` overrides the default session file `~/.cursor-telegram-plugin/user.session`.

## Example prompts

**Bot**

- “Verify my Telegram bot with `telegram-bot` `get_me`. Do not print the token.”
- “I just /start’ed the bot. List recent chats, then send ‘hello from Cursor’ to my DM after I confirm.”

**User**

- “I want messages sent as me, not as a bot. Walk me through my.telegram.org and first login.”
- “Search my Telegram dialogs for ‘Ada’, then send this text after I confirm.”
- “Show recent messages in Saved Messages (`me`) using the user account.”

## How to test

### Bot API `send_message`

1. `/start` the bot (or add it to a group/channel).
2. Set `TELEGRAM_BOT_TOKEN`.
3. In Agent chat: `get_me` → `list_recent_chats` → confirm → `send_message`.
4. Optional:

```bash
export TELEGRAM_BOT_TOKEN="…"   # local shell only
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

### User-account send (as you)

1. Set `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.
2. Login once:

```bash
export TELEGRAM_API_ID="…"
export TELEGRAM_API_HASH="…"
node packages/mcp-user-server/dist/login.js
```

Or use `start_login` / `start_qr_login` from the agent.

3. Confirm `get_me` is your user (`isBot: false`).
4. `list_dialogs` / `search_dialogs`, confirm destination + text, then `send_message`.

Automated tests mock Telegram (no live token or account). Node.js 20+ is required.

```bash
npm install --prefix packages/mcp-server
npm install --prefix packages/mcp-user-server
npm test
npm run build
npm run validate
```

## Chat list limitation (Bot API only)

The Bot API **cannot** list every chat a bot belongs to. `list_recent_chats` only inspects recent `getUpdates` events. If nothing shows up: the user has not `/start`ed the bot, the group is quiet, or a **webhook** is set.

User-account mode uses the real dialog list and does not have this limitation.

## Why first-party servers (not a random npm MCP)

Public packages exist (Bot API wrappers; user MCPs such as [`@overpod/mcp-telegram`](https://www.npmjs.com/package/@overpod/mcp-telegram) / [mcp-telegram/mcp-telegram](https://github.com/mcp-telegram/mcp-telegram)). They are real, but they are either very large or a different product.

This plugin ships two small stdio servers:

- **Bot:** official HTTP Bot API only (`packages/mcp-server`)
- **User:** teleproto MTProto user client (`packages/mcp-user-server`), tools limited to login, dialogs, history, and send

`node` runs committed esbuild bundles under each package’s `dist/` (no extra `npx` package at runtime).

```bash
npm run build
```

`mcp.json` launches both:

```json
{
  "telegram-bot": {
    "command": "node",
    "args": ["${PLUGIN_ROOT}/packages/mcp-server/dist/index.js"],
    "env": { "TELEGRAM_BOT_TOKEN": "${TELEGRAM_BOT_TOKEN}" }
  },
  "telegram-user": {
    "command": "node",
    "args": ["${PLUGIN_ROOT}/packages/mcp-user-server/dist/index.js"],
    "env": {
      "TELEGRAM_API_ID": "${TELEGRAM_API_ID}",
      "TELEGRAM_API_HASH": "${TELEGRAM_API_HASH}",
      "TELEGRAM_SESSION": "${TELEGRAM_SESSION}"
    }
  }
}
```

## Marketplace notes

- Single Cursor Plugin (`.cursor-plugin/plugin.json`), not a multi-plugin `marketplace.json` repo.
- **MTProto user client + Bot API**, not Bot API alone.
- Plugin `name` remains `telegram-bot` for continuity with v0.1.0; product copy and `displayName` describe both modes.
- Version `0.2.0`, MIT, logo at `assets/logo.svg`.
- Variables: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION` (all optional in the schema).
- Submit: [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

## Layout

```text
.
├── .cursor-plugin/plugin.json
├── mcp.json
├── skills/
│   ├── telegram-mode-guide/SKILL.md
│   ├── telegram-bot-setup/SKILL.md
│   ├── send-telegram-message/SKILL.md
│   ├── telegram-user-setup/SKILL.md
│   └── send-telegram-user-message/SKILL.md
├── assets/logo.svg
├── packages/mcp-server/        # Bot API MCP + dist bundle
├── packages/mcp-user-server/   # GramJS user MCP + dist bundle
├── LICENSE
└── README.md
```

## License

[MIT](LICENSE) © Lotus / Lotus015 ([GitHub](https://github.com/Lotus015))
