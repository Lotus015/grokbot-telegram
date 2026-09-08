---
name: send-telegram-user-message
description: Send a Telegram message as the logged-in personal account (MTProto user session). Use when the user wants to message in their own name, not as a bot.
---

# Send a Telegram message as the user

Use the **telegram-user** MCP server. The message appears as the logged-in person, not as a @bot. If they wanted the BotFather bot instead, use `send-telegram-message`.

## Before you send

1. Call `auth_status`. If not configured, use `telegram-user-setup`. Never ask them to paste `api_hash` or a session string into chat unless they are explicitly saving `TELEGRAM_SESSION` once.
2. Resolve the chat from the **real dialog list** (`list_dialogs` / `search_dialogs`), or from a username / id they gave.
3. Show the exact destination (title, username, id) and the exact text. **Wait for explicit confirmation** before sending to anyone except a user-requested `me` test they already approved.
4. Never print the session string or `api_hash` after first-run save.

## How to resolve chat

| User provides | What to use as `chat` |
| --- | --- |
| `me` / Saved Messages | `me` |
| `@username` | `@username` or `username` |
| Numeric id from `list_dialogs` | That id string |
| Display name (“Mom”, “Work”) | `search_dialogs` with that query; if one clear match, use its id; if several, ask |
| Nothing | `list_dialogs` and ask them to pick |

If search is empty, they may need to open that chat once in Telegram so it appears in dialogs, or give `@username` / id.

Optional: `get_messages` on the candidate chat so they can confirm it is the right thread.

## Sending

Call **telegram-user** `send_message` with:

- `chat`: `me`, `@username`, or dialog id
- `text`: the message body

After success, report message id, destination title/id, and that it was sent **as their user account**. Do not dump raw MTProto objects.

## Safety

- Do not send to a chat they did not name or confirm.
- Do not broadcast to every dialog.
- Do not include secrets in message text.
- Do not loop or bulk-send (account restriction risk).
- Confirm every consequential send. “Consequential” = any real person, group, or channel.

## Disclaimer footer

Messages here go out **as the human account owner**, so the server appends `— sent by grokbot-telegram on my behalf` to every one of them unless `TELEGRAM_DISCLAIMER` is off. Do not write your own footer into `text` — you would get two.

The footer counts against the 4096-character limit. If a send is refused for length, shorten the message or split it; do not disable the disclaimer to make room unless the user explicitly asks.

## Naming the destination

Send to an **id from `list_dialogs`** whenever you have one. That is the only form that goes straight out; everything else costs a lookup first.

What each form does:

- **id** (`-5532867099`, `777000`) or **`me`** — sent directly, no extra call.
- **`@username`** — taken at face value, sent directly.
- **a bare word** (`durov`) — ambiguous, since it could be a username or the name of one of their chats. Their own dialogs are checked first, because sending to a stranger who happens to hold that username is the worse mistake. Only if nothing matches is it treated as a username.
- **a title** (`Holandija 2026`) — resolved against the dialog list. An exact title wins; an ambiguous one is refused with the candidates listed, and you must ask the user which they meant rather than picking one.

A title that matches nothing fails immediately and says so. If you see that, call `list_dialogs`, confirm the chat with the user, and send to its id.

## Groups with topics

If `list_dialogs` marks a chat `isForum: true`, its messages live in separate threads. Call `list_forum_topics` and confirm the topic with the user before sending, then pass its id as `topic_id`.

Do not guess a topic id and do not reuse one from an earlier conversation. Telegram does not reject a wrong id — it files the message under General, visible to the whole group. `send_message` verifies the id for you and refuses rather than sending, but the confirmation is still yours to get.

Without `topic_id` the message goes to the chat itself, which in a forum means General.
