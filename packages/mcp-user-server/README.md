# cursor-telegram-user-mcp

Stdio [MCP](https://modelcontextprotocol.io) server for a **personal Telegram account** via [MTProto](https://core.telegram.org/mtproto) ([teleproto](https://github.com/sanyok12345/teleproto)). Used by the [Cursor Telegram plugin](https://github.com/Lotus015/cursor-telegram-plugin) and any MCP host (Cursor, Grok Bot, Claude Desktop).

Credentials are read from the environment. **Nothing secret is shipped in this package.** A session string is full account access — treat it like a password.

## Run (no clone)

```bash
export TELEGRAM_API_ID="…"
export TELEGRAM_API_HASH="…"
export TELEGRAM_SESSION="…"   # after first login
npx -y cursor-telegram-user-mcp
```

One-time terminal login (writes `~/.cursor-telegram-plugin/user.session` at mode `0600`):

```bash
export TELEGRAM_API_ID="…"
export TELEGRAM_API_HASH="…"
npx -y -p cursor-telegram-user-mcp telegram-user-login
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_API_ID` | Yes | App id from [my.telegram.org/apps](https://my.telegram.org/apps) |
| `TELEGRAM_API_HASH` | Yes | App hash from the same page |
| `TELEGRAM_SESSION` | After first login | GramJS / teleproto session string (or use the session file) |
| `TELEGRAM_SESSION_PATH` | No | Override session file path |

Telegram still requires api_id / api_hash and a one-time login. This package cannot skip that.

## Cursor / Grok Bot

```json
{
  "mcpServers": {
    "telegram-user": {
      "command": "npx",
      "args": ["-y", "cursor-telegram-user-mcp"],
      "env": {
        "TELEGRAM_API_ID": "your-api-id",
        "TELEGRAM_API_HASH": "your-api-hash",
        "TELEGRAM_SESSION": "your-session-string"
      }
    }
  }
}
```

Source: [`packages/mcp-user-server`](https://github.com/Lotus015/cursor-telegram-plugin/tree/main/packages/mcp-user-server) in [Lotus015/cursor-telegram-plugin](https://github.com/Lotus015/cursor-telegram-plugin).
