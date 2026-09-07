---
name: telegram-mode-guide
description: Choose Telegram Bot API vs personal-account MTProto. Use when the user asks which Telegram mode to use, "send as me", "userbot", or whether they need a bot token vs api_id.
---

# Bot API vs personal Telegram account

This plugin ships **two** MCP servers. Use one or both. Do not mix their credentials.

| | `telegram-bot` (Bot API) | `telegram-user` (MTProto) |
| --- | --- | --- |
| Identity | The `@bot` from BotFather | The user's personal Telegram account |
| Credentials | `TELEGRAM_BOT_TOKEN` | `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, session |
| Chat list | Recent `getUpdates` only | Real dialog list (`list_dialogs`) |
| Can DM first | No — user must `/start` | Yes — same as the Telegram app |
| Risk | Bot token | **Full account access** (session = password) |

## When to use which

- User says **“send as the bot”**, notifications, channels the bot admins, CI alerts → **Bot API**. Skill: `telegram-bot-setup` / `send-telegram-message`.
- User says **“send as me”**, “in my name”, “my account”, “userbot”, “read my chats” → **user account**. Skill: `telegram-user-setup` / `send-telegram-user-message`.
- Unclear → ask. Default to Bot API if they already have a bot token and did not ask to act as themselves.

## Tool namespaces

Both servers expose `send_message` and `get_me`. Prefer the MCP server name:

- Bot: `telegram-bot` → `get_me`, `send_message`, `get_updates`, `list_recent_chats`
- User: `telegram-user` → `auth_status`, `start_login`, `complete_login`, `start_qr_login`, `complete_qr_login`, `get_me`, `list_dialogs`, `search_dialogs`, `get_messages`, `send_message`

Never pass `TELEGRAM_BOT_TOKEN` into the user server or `TELEGRAM_API_*` / session into the bot server.
