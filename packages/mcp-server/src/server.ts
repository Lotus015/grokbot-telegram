import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { chatsFromUpdates, type TelegramUpdate } from "./chats.js";
import { safeErrorMessage } from "./redact.js";
import { getMe, getUpdates, sendMessage } from "./telegram.js";

const VERSION = "0.2.0";

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: safeErrorMessage(err, token),
      },
    ],
  };
}

const chatIdSchema = z
  .union([z.string().min(1), z.number()])
  .describe(
    "Destination chat: numeric chat_id (user/group/supergroup/channel) or @username of a public channel/group.",
  );

export function createTelegramMcpServer(): McpServer {
  const server = new McpServer({
    name: "telegram-bot",
    version: VERSION,
  });

  server.registerTool(
    "get_me",
    {
      title: "Get bot identity",
      description:
        "[Bot API] Call Telegram getMe. Returns the bot id, name, and username. Use to verify TELEGRAM_BOT_TOKEN works. Never log the token. For the personal account, use the telegram-user MCP server instead.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return jsonResult(await getMe());
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "send_message",
    {
      title: "Send Telegram message",
      description:
        "[Bot API] Send as the bot via sendMessage (not the user's personal account). Confirm destination and text before sending consequential messages. chat_id may be a number or @username for a public channel/group.",
      inputSchema: z.object({
        chat_id: chatIdSchema,
        text: z.string().min(1).max(4096).describe("Message text to send."),
        parse_mode: z
          .enum(["HTML", "Markdown", "MarkdownV2"])
          .optional()
          .describe("Optional Telegram parse mode. Omit for plain text."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ chat_id, text, parse_mode }) => {
      try {
        const result = await sendMessage({ chat_id, text, parse_mode });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_updates",
    {
      title: "Get Telegram updates",
      description:
        "[Bot API] Call Telegram getUpdates (long-poll/debug). Omit offset to peek without acknowledging. Passing offset greater than an update_id confirms (consumes) those updates. Fails if a webhook is set.",
      inputSchema: z.object({
        offset: z
          .number()
          .int()
          .optional()
          .describe(
            "First update_id to return. Use last update_id + 1 to acknowledge previous updates.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max updates to return (1–100)."),
        timeout: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe("Long-poll timeout in seconds. Default 0 (short poll)."),
        allowed_updates: z
          .array(z.string())
          .optional()
          .describe("Optional list of update types, e.g. [\"message\"]."),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await getUpdates({
          offset: params.offset,
          limit: params.limit,
          timeout: params.timeout ?? 0,
          allowed_updates: params.allowed_updates,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_recent_chats",
    {
      title: "List recent chats from updates",
      description:
        "[Bot API] Best-effort chat list derived from getUpdates. Bot API cannot enumerate every chat a bot is in. For the real dialog list, use telegram-user list_dialogs. Private users must /start the bot in DMs first.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max updates to inspect (1–100). Default 100."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit }) => {
      try {
        const updates = (await getUpdates({
          limit: limit ?? 100,
          timeout: 0,
        })) as TelegramUpdate[];
        return jsonResult({
          chats: chatsFromUpdates(updates),
          update_count: updates.length,
          note: "Not a full inbox. Only chats seen in recent Bot API updates. Private users must /start the bot. Public channels/groups can also be addressed as @username.",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
