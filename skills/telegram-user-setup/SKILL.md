---
name: telegram-user-setup
description: Log into Telegram as the user's personal account (MTProto). Use when setting up api_id/api_hash, first login, QR/session, or when Bot API is the wrong identity.
---

# Set up personal-account Telegram (MTProto)

This path logs in as the **user's real Telegram account** via [teleproto](https://github.com/sanyok12345/teleproto) (maintained GramJS fork, MTProto). Messages are sent **in their name**, not as a @BotFather bot.

**Security (read this first):** a session string or session file is **full access** to that Telegram account — equivalent to being logged in on a new device. Treat it like a password. Never commit it, never paste it into git, issues, or screenshots, and do not store it in the repo. Anyone with the session can read chats and send as the user.

This plugin does **not** require `TELEGRAM_BOT_TOKEN` for user-account mode.

## What the user must provide (first run)

1. **`TELEGRAM_API_ID`** and **`TELEGRAM_API_HASH`** from [my.telegram.org/apps](https://my.telegram.org/apps) (Telegram login, then **API development tools** → create an app).
2. A **one-time login**: phone + login code (and 2FA cloud password if enabled), **or** QR (“Link Desktop Device”), **or** an existing GramJS / teleproto / Telethon **session string**.
3. After login, persist the session as `TELEGRAM_SESSION` in Plugins → Configure and/or keep the local session file (`~/.grokbot-telegram/user.session`, mode `0600`).

Ping the user for api_id / api_hash / phone or QR. **Never ask them to paste secrets into git.** Prefer Plugins → Configure. If they must show a session string once so it can be saved, tell them to store it immediately and not to repeat it in later chats.

## 1. Create an app at my.telegram.org

1. Open [https://my.telegram.org/apps](https://my.telegram.org/apps) and log in with the **same phone number** as the Telegram account they want to use.
2. Open **API development tools**.
3. Create an application (any title / short name; platform can be “Other”).
4. Copy **App api_id** (integer) and **App api_hash** (hex string).
5. Set them in Cursor **Plugins → Configure**: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`.
6. Reload the window if `telegram-user` tools do not appear.

`api_hash` is a secret. Do not commit it.

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
