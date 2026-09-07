---
name: send-telegram-message
description: Send or post a Telegram message as the BotFather bot (Bot API). Use when the user asks to send via the bot, a notification bot, or Bot API sendMessage — not when they want to send as themselves.
---

# Send a Telegram message as the bot

Use this skill when the user wants a Telegram message sent through the **telegram-bot** MCP server (official Bot API). If they want the message to appear **as their personal account**, use `send-telegram-user-message` instead.

## Before you send

1. Confirm Bot API mode is configured. If tools fail with a missing-token error, point the user at Plugins → Configure and the `telegram-bot-setup` skill. Never ask them to paste the token into chat.
2. Resolve the destination **before** calling `telegram-bot` `send_message`.
3. Show the user the exact `chat_id` (or `@username`) and the exact message text. Wait for explicit confirmation before sending anything consequential (anything that leaves this machine: real chats, groups, channels, production alerts).
4. Never print, log, or quote `TELEGRAM_BOT_TOKEN`. If a tool error includes a URL or token-shaped string, redact it.

## How to resolve chat

Prefer the most specific identifier the user already gave, in this order:

| User provides | What to use |
| --- | --- |
| Numeric `chat_id` (e.g. `123456789` or `-100…` for groups/channels) | Pass it as `chat_id` |
| Public channel/group `@username` | Pass it as `chat_id` (Bot API accepts `@channelusername`) |
| A person by name only | Ask for `chat_id` or have them message the bot, then use `list_recent_chats` / `get_updates` |
| Nothing | Ask. Do not guess a chat. |

**Bot API limitation (important):** a bot cannot list every chat it belongs to the way a user account can. There is no “inbox” or dialog list. `list_recent_chats` only returns chats that recently produced **getUpdates** events (messages, membership changes, and similar). Private users must `/start` the bot (or send it a message) before you can see their `chat_id`. `@username` works for **public channels/groups**, not as a general “message any user by username” feature.

If the destination is unclear:

1. Call `telegram-bot` `get_me` to verify the bot is reachable.
2. Call `list_recent_chats` (and `get_updates` if you need more context).
3. If the target is still missing, tell the user to open a DM with the bot, tap **Start**, then retry.

## Sending

Call MCP tool `send_message` on **telegram-bot** with:

- `chat_id` (string or number): numeric id or `@username` for a public channel/group
- `text`: the message body
- `parse_mode` (optional): `HTML`, `Markdown`, or `MarkdownV2`

Use `parse_mode` only when the user asked for formatting **and** the text is valid for that mode. MarkdownV2 is easy to break with unescaped characters; if a formatted send fails, retry as plain text after confirming with the user.

After a successful send, report `message_id` and destination chat (id, title/name, username if any). Do not dump the full raw API payload unless the user wants it.

## Safety

- Do not send to a chat the user did not name or confirm.
- Do not broadcast to every chat from `list_recent_chats`.
- Do not include secrets (tokens, passwords, private keys) in message text.
- Group/channel sends only work if the bot is a member (and, for posting to channels, an admin with post permission).
- `get_updates` can acknowledge/consume updates if you pass `offset`. For a quick look, omit `offset` so pending updates stay pending. If the bot uses a webhook, `getUpdates` will fail until the webhook is removed.
