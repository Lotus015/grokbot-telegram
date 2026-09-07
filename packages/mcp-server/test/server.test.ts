import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createTelegramMcpServer } from "../src/server.js";

const TOKEN = "123456789:AAHfakeTokenValueForTestsOnly1234567";

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_DISCLAIMER;
});

async function connectClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createTelegramMcpServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

describe("telegram MCP server", () => {
  it("registers the v1 tools", async () => {
    const { client, server } = await connectClient();
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      assert.deepEqual(names, [
        "get_me",
        "get_updates",
        "list_recent_chats",
        "send_message",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("get_me returns a helpful error when the token is missing", async () => {
    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: "get_me", arguments: {} });
      assert.equal(result.isError, true);
      const text = (result.content[0] as { text: string }).text;
      assert.match(text, /TELEGRAM_BOT_TOKEN is missing/);
      assert.equal(text.includes(TOKEN), false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("send_message hits Bot API and returns the Telegram result", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      assert.equal(url.includes(TOKEN), true);
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        chat_id: number;
        text: string;
      };
      assert.equal(body.chat_id, 99);
      assert.equal(body.text, "hello from test\n\n— sent by grokbot-telegram");
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 7,
            chat: { id: 99, type: "private", first_name: "Ada" },
            text: body.text,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "send_message",
        arguments: { chat_id: 99, text: "hello from test" },
      });
      const text = (result.content[0] as { text: string }).text;
      assert.equal(text.includes(TOKEN), false);
      assert.equal(result.isError ?? false, false, text);
      const parsed = JSON.parse(text) as { message_id: number };
      assert.equal(parsed.message_id, 7);
    } finally {
      globalThis.fetch = original;
      await client.close();
      await server.close();
    }
  });

  it("list_recent_chats extracts unique chats from getUpdates", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.match(String(input), /getUpdates$/);
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                chat: { id: 42, type: "private", first_name: "Ada", username: "ada" },
              },
            },
            {
              update_id: 2,
              my_chat_member: { chat: { id: -100, type: "supergroup", title: "Team" } },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({
        name: "list_recent_chats",
        arguments: {},
      });
      const text = (result.content[0] as { text: string }).text;
      assert.equal(text.includes(TOKEN), false);
      assert.equal(result.isError ?? false, false, text);
      const parsed = JSON.parse(text) as {
        chats: Array<{ id: number; username?: string; title?: string }>;
        update_count: number;
      };
      assert.equal(parsed.update_count, 2);
      assert.equal(parsed.chats.length, 2);
      assert.ok(parsed.chats.some((c) => c.id === 42 && c.username === "ada"));
      assert.ok(parsed.chats.some((c) => c.id === -100 && c.title === "Team"));
    } finally {
      globalThis.fetch = original;
      await client.close();
      await server.close();
    }
  });
});
