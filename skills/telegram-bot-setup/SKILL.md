---
name: telegram-bot-setup
description: Create a Telegram bot with @BotFather, configure TELEGRAM_BOT_TOKEN in Cursor Plugins, and smoke-test sendMessage. Use when installing Bot API mode, when the token is missing, or when the bot cannot send.
---

# Set up Telegram Bot API mode

Walk the user through creating a **bot**, storing the token in Cursor (not in git), and proving `sendMessage` works. This is **not** personal-account login. For “send as me”, use `telegram-user-setup`.

## 1. Create a bot with BotFather

1. Open Telegram and chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Follow the prompts (display name, then username ending in `bot`).
4. Copy the HTTP API token BotFather returns. It looks like `123456789:AAH...`.
5. Treat the token as a **password**. Anyone with it can control the bot.

Optional: `/setprivacy` (disable privacy mode if the bot should read all group messages), `/setjoingroups`, `/setcommands`.

## 2. Put the token in Cursor — not in the repo

1. Install this plugin (Marketplace, [cursor.directory](https://cursor.directory), or a local clone).
2. Open **Plugins → Configure** for this plugin.
3. Set `TELEGRAM_BOT_TOKEN` to the BotFather token. Leave `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION` empty unless they also want user-account mode.
4. Reload the window if the `telegram-bot` MCP server does not start.

Never commit the token, never paste it into chat, and never put it in `mcp.json`. The plugin only ships a `${TELEGRAM_BOT_TOKEN}` placeholder.

Hand-running the bot server (development):

```bash
cp .env.example .env   # then edit locally; .env is gitignored
export TELEGRAM_BOT_TOKEN="…"   # shell only, do not echo
node packages/mcp-server/dist/index.js
```

## 3. Smoke-test

The user must message the bot at least once in a DM (`/start`). Bots cannot start a private chat.

Then, in Cursor Agent chat:

1. Ask: “Call `telegram-bot` `get_me` and tell me the bot username (do not print the token).”
2. Ask the user to send any text to the bot in Telegram.
3. Ask: “List recent chats the bot can see, then send ‘hello from Cursor’ to my DM after I confirm.”
4. Confirm destination + text, then send.

Manual API check (token stays in the environment, not in argv if you can avoid it):

```bash
# Proves the token works. Do not paste the token into the command line from a shared log.
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

To send without Cursor, the user needs their numeric `chat_id` (from `list_recent_chats` after they `/start` the bot):

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H 'Content-Type: application/json' \
  -d '{"chat_id": 123456789, "text": "hello from curl"}'
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Missing / placeholder token | Plugins → Configure is unset; `${TELEGRAM_BOT_TOKEN}` was not substituted |
| `Unauthorized` | Wrong or revoked token; create a new one with BotFather `/token` |
| `chat not found` | Wrong id, user never `/start`ed the bot, or `@username` used for a private user |
| `bot is not a member` | Add the bot to the group/channel; for channels, grant post permission |
| `getUpdates` conflict | A webhook is set on this bot; delete it or do not use polling tools |
| Empty `list_recent_chats` | No recent updates. User should `/start` or send a message, then retry |

This is **HTTP Bot API only**. Messages are sent **as the bot**, not as the user's personal account. User-account / MTProto setup is a separate path (`telegram-user-setup`).
