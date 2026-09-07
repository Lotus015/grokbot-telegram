# cursor-telegram-bot-mcp

Stdio [MCP](https://modelcontextprotocol.io) server for the official Telegram **Bot API**. Used by the [Cursor Telegram plugin](https://github.com/Lotus015/cursor-telegram-plugin) and any MCP host (Cursor, Grok Bot, Claude Desktop).

Credentials are read from the environment. **Nothing secret is shipped in this package.**

## Run (no clone)

```bash
export TELEGRAM_BOT_TOKEN="…"   # from @BotFather
npx -y cursor-telegram-bot-mcp
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes (for send / getMe) | Bot token from [@BotFather](https://t.me/BotFather) |

Tools still *list* without a token so an MCP host can start the server; send/getMe fail until the token is set.

## Cursor / Grok Bot

```json
{
  "mcpServers": {
    "telegram-bot": {
      "command": "npx",
      "args": ["-y", "cursor-telegram-bot-mcp"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your-bot-token"
      }
    }
  }
}
```

Telegram still requires a BotFather token. This package cannot skip that.

Source: [`packages/mcp-server`](https://github.com/Lotus015/cursor-telegram-plugin/tree/main/packages/mcp-server) in [Lotus015/cursor-telegram-plugin](https://github.com/Lotus015/cursor-telegram-plugin).
