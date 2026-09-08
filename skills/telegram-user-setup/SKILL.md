---
name: telegram-user-setup
description: Log into Telegram as the user's personal account (MTProto). Use when setting up api_id/api_hash, first login, QR/session, or when Bot API is the wrong identity.
---

# Set up personal-account Telegram (MTProto)

This path logs in as the **user's real Telegram account** via [teleproto](https://github.com/sanyok12345/teleproto) (maintained GramJS fork, MTProto). Messages are sent **in their name**, not as a @BotFather bot.

**Security (read this first):** a session string or session file is **full access** to that Telegram account — equivalent to being logged in on a new device. Treat it like a password. Never commit it, never paste it into git, issues, or screenshots, and do not store it in the repo. Anyone with the session can read chats and send as the user.

This plugin does **not** require `TELEGRAM_BOT_TOKEN` for user-account mode.

## Why the user has to fetch api_id themselves

Telegram issues `api_id`/`api_hash` per developer and **actively rejects credentials that have been published**: a shared pair baked into a distributed app earns every user an `API_ID_PUBLISHED_FLOOD` error at login. So this package cannot ship one, and there is no workaround to look for. Say this plainly if the user pushes back — it is Telegram's rule, not a limitation of the plugin.

It is a one-time, roughly two-minute detour. Your job is to make it feel that short.

If the user only wants notifications, or to post to a channel or group, **offer the Bot API path instead**: `@BotFather` inside Telegram, thirty seconds, no `api_id` at all. Only the user-account path needs this.

## What the user must provide (first run)

1. **`api_id`** and **`api_hash`** — walk them through §1 below, then call `save_api_credentials`. They do not have to touch a config file.
2. A **one-time login**: phone + login code (and 2FA cloud password if enabled), **or** QR, **or** an existing GramJS / teleproto / Telethon **session string**.
3. Nothing after that. The session is written to `~/.grokbot-telegram/user.session` at mode `0600` and reused.

**Never ask them to paste secrets into git.** If a session string has to be shown once, tell them to store it immediately and not to repeat it in later chats.

## 1. Create an app at my.telegram.org

Give the user these steps in one message, numbered, with the link first. Do not spread them over several turns — the whole point is that this takes two minutes.

1. Open **https://my.telegram.org/apps**
2. Enter the **phone number of the account you want me to use**, then the code Telegram sends you *in the app*.
3. Click **API development tools**.
4. Fill **App title** and **Short name** with anything (e.g. `grokbot`). Leave the rest empty, platform **Other**. Click **Create application**.
5. Copy **api_id** (a number) and **api_hash** (32 characters).

Then ask for both and call `save_api_credentials` with them. It stores the pair at mode `0600` next to the session, so the user never edits a config file.

Two things to hold onto while doing this:

- **`api_hash` is a secret.** Do not repeat it back in chat, do not put it in a summary, do not write it to a file of your own. The tool deliberately does not echo it.
- If the tool rejects the values, it is almost always the classic mistake: the two got swapped, or `api_hash` was copied short. Ask for them again rather than guessing.

Setting `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` as environment variables still works and takes precedence — that is the path for developers who bring their own app.

## 2. First login (pick one)

Call `telegram-user` `auth_status` first. If `authorized` is true, skip login.

### A. Phone + code (MCP)

1. Ask for the phone number in international form (`+15551234567`).
2. Call `start_login` with that phone.
3. Telegram sends a login code to the Telegram app (or SMS).
4. Ask the user for the code (and 2FA password if `auth_status` / the error says it is required).
5. Call `complete_login` with `code` and optional `password`.
6. Tell them to save the returned `session` in **Plugins → Configure → TELEGRAM_SESSION** (or rely on the written session file). Treat it as a password.

### B. QR (MCP)

1. Call `start_qr_login`.
2. Show the `login_url` (`tg://login?token=…`). On a phone: Telegram → **Settings → Devices → Link Desktop Device** and scan / open the link.
3. Call `complete_qr_login` (pass `password` if 2FA is enabled). Wait for them to scan before this call, or retry if it says still waiting.
4. Save the session as in A.

### C. Existing session string

Paste it only into **Plugins → Configure → TELEGRAM_SESSION**. Then `auth_status` / `get_me`.

### D. Terminal CLI (same machine)

```bash
export TELEGRAM_API_ID="…"
export TELEGRAM_API_HASH="…"
node packages/mcp-user-server/dist/login.js
```

The CLI writes `~/.grokbot-telegram/user.session` (`0600`) and prints the session string once.

## 3. Smoke-test

1. `get_me` — confirm it is **not** a bot (`isBot` false) and the name/username matches the user.
2. `list_dialogs` or `search_dialogs` — real inbox, not Bot API updates.
3. Send a test to `me` only after they confirm.

## Session persistence

| Source | Priority |
| --- | --- |
| `TELEGRAM_SESSION` env / Plugins → Configure | Highest |
| `TELEGRAM_SESSION_PATH` file | If env session is empty |
| `~/.grokbot-telegram/user.session` | Default file |

Restarting Cursor reuses the session. Do not check session files into git (they are gitignored).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Missing api_id / api_hash | Plugins → Configure unset; placeholders not substituted |
| `PHONE_NUMBER_INVALID` | Use `+` and country code |
| `PHONE_CODE_INVALID` / expired | Request a new code with `start_login` again |
| `SESSION_PASSWORD_NEEDED` | Account has 2FA; pass `password` to `complete_login` / `complete_qr_login` |
| `AUTH_KEY_DUPLICATED` | Same session used by two processes; stop the extra client |
| Unauthorized after restart | Session not saved; set `TELEGRAM_SESSION` or keep the session file |
| Flood / slow | Back off. Do not loop login or bulk-send |

## Warnings

- Automating a **user** account is a Telegram ToS gray area. Keep sends human-paced. No spam or bulk broadcast.
- Revoke access: Telegram → Settings → Devices → terminate the unknown session, then delete the session file / clear `TELEGRAM_SESSION`.
- This is **not** Bot API. A bot token cannot log into this server.

## Login survives a restart

`start_login` and `complete_login` do not have to run in the same process. The pending state is persisted next to the session file, so if the MCP server restarts between the two calls, `complete_login` still works — do not make the user start over just because the process cycled.

If `complete_login` reports no pending login, the code genuinely expired (15 minutes). Call `start_login` again.

## QR after a restart

A QR code lives about half a minute, and the scan authorizes the session rather than handing back something to redeem. So after a restart `complete_qr_login` either succeeds outright — the scan already landed and the session is adopted — or it returns `waiting: true` **with a new `login_url`**.

When you get that, show the new `login_url`. Do not tell the user to scan again the code you showed before: it can no longer be completed, and re-showing it is the one thing guaranteed not to work.

## Prefer phone login in a chat

QR is the worse path when login happens through a conversation. Telegram gives a QR token roughly 30 seconds, and that clock starts when `start_qr_login` returns — not when the user finally sees the code. Rendering it into a chat, the user reading it, picking up the phone and opening Settings → Devices routinely costs more than the whole window.

**Default to `start_login` with a phone number.** The code lives minutes rather than seconds, it survives a process restart, and there is nothing to render in time.

Use QR only when the user does not want to give a phone number, or asks for it. Then:

- **The scannable QR image is attached to the tool result** as a base64 PNG in `content[0]`. Forward that image immediately, on its own, before any explanation. Do not generate your own picture of the code and do not send `login_url` as a substitute — both spend the window you are racing.
- Some hosts do not paint tool-result images by themselves. If yours does not, forward the base64 you already have; do not write it to a file and attach it by path, and do not copy it anywhere first. Every extra hop costs seconds you do not have.
- `login_url` is a `tg://` link, and it is a fallback for clients that cannot show images. It is useless to a user whose phone does not have the app that opens it; assume they need to scan.
- Read `expires_in_seconds` and say it plainly: "about 30 seconds".
- If `complete_qr_login` reports waiting, it hands back a **fresh** code, image included. Show that one. Repeat as needed — each attempt restarts the clock. Never re-show a code from an earlier reply.
- After two failed windows, offer phone login instead of a third QR.
