import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createTelegramUserMcpServer } from "../src/server.js";
import type { TelegramUserClient, UserInfo } from "../src/types.js";
import type { DialogSummary } from "../src/dialogs.js";

const me: UserInfo = {
  id: "42",
  username: "ada",
  firstName: "Ada",
  isBot: false,
};

function mockClient(overrides: Partial<TelegramUserClient> = {}): TelegramUserClient {
  const dialogs: DialogSummary[] = [
    { id: "42", title: "Ada Lovelace", type: "user", username: "ada" },
    { id: "-100", title: "Work Team", type: "group" },
  ];
  return {
    connect: async () => {},
    disconnect: async () => {},
    isAuthorized: async () => true,
    getMe: async () => me,
    listDialogs: async () => dialogs,
    getMessages: async (chat) => [
      { id: 1, text: `hello ${chat}`, out: false, senderId: "7" },
    ],
    sendMessage: async (chat, text) => ({
      id: 99,
      chatId: chat,
      text,
    }),
    sendCode: async () => ({ phoneCodeHash: "hash1", isCodeViaApp: true }),
    signIn: async () => me,
    signInWithPassword: async () => me,
    exportLoginToken: async () => ({
      kind: "token",
      token: Buffer.from("qr-token"),
      expires: 1_700_000_000,
    }),
    importLoginToken: async () => ({ kind: "success", user: me }),
    switchDc: async () => {},
    onLoginToken: () => () => {},
    exportSession: () => "MOCKSESSIONSTRING".repeat(6),
    ...overrides,
  };
}

async function connectClient(clientImpl: TelegramUserClient) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createTelegramUserMcpServer({
    createClient: () => clientImpl,
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

const expectedTools = [
  "auth_status",
  "complete_login",
  "complete_qr_login",
  "get_me",
  "get_messages",
  "list_dialogs",
  "save_api_credentials",
  "search_dialogs",
  "send_message",
  "start_login",
  "start_qr_login",
];

afterEach(() => {
  delete process.env.TELEGRAM_API_ID;
  delete process.env.TELEGRAM_API_HASH;
  delete process.env.TELEGRAM_SESSION;
  delete process.env.TELEGRAM_SESSION_PATH;
  delete process.env.TELEGRAM_DISCLAIMER;
});

describe("telegram user MCP server", () => {
  it("registers the v1 user-account tools", async () => {
    const { client, server } = await connectClient(mockClient());
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      assert.deepEqual(names, expectedTools);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("auth_status reports missing credentials without throwing a tool crash", async () => {
    const { client, server } = await connectClient(mockClient());
    try {
      const result = await client.callTool({ name: "auth_status", arguments: {} });
      const text = (result.content[0] as { text: string }).text;
      assert.equal(result.isError ?? false, false, text);
      const parsed = JSON.parse(text) as { configured: boolean; authorized: boolean };
      assert.equal(parsed.configured, false);
      assert.equal(parsed.authorized, false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("lists dialogs, searches, reads history, and sends as the user", async () => {
    process.env.TELEGRAM_API_ID = "1";
    process.env.TELEGRAM_API_HASH = "abc";
    const dir = mkdtempSync(join(tmpdir(), "tg-user-"));
    process.env.TELEGRAM_SESSION_PATH = join(dir, "user.session");

    const { client, server } = await connectClient(mockClient());
    try {
      const listed = await client.callTool({
        name: "list_dialogs",
        arguments: {},
      });
      const listedText = (listed.content[0] as { text: string }).text;
      assert.equal(listed.isError ?? false, false, listedText);
      const dialogs = JSON.parse(listedText) as { count: number };
      assert.equal(dialogs.count, 2);

      const searched = await client.callTool({
        name: "search_dialogs",
        arguments: { query: "work" },
      });
      const searchText = (searched.content[0] as { text: string }).text;
      const search = JSON.parse(searchText) as {
        dialogs: Array<{ id: string }>;
      };
      assert.equal(search.dialogs[0]?.id, "-100");

      const history = await client.callTool({
        name: "get_messages",
        arguments: { chat: "me" },
      });
      const historyText = (history.content[0] as { text: string }).text;
      assert.match(historyText, /hello me/);

      const sent = await client.callTool({
        name: "send_message",
        arguments: { chat: "me", text: "hello from test" },
      });
      const sentText = (sent.content[0] as { text: string }).text;
      assert.equal(sent.isError ?? false, false, sentText);
      const parsed = JSON.parse(sentText) as {
        id: number;
        identity: string;
        text: string;
      };
      assert.equal(parsed.id, 99);
      assert.equal(parsed.identity, "user-account");
      assert.equal(
        parsed.text,
        "hello from test\n\n— sent by grokbot-telegram on my behalf",
      );

      const meResult = await client.callTool({ name: "get_me", arguments: {} });
      const meText = (meResult.content[0] as { text: string }).text;
      const parsedMe = JSON.parse(meText) as UserInfo;
      assert.equal(parsedMe.isBot, false);
      assert.equal(parsedMe.username, "ada");
    } finally {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the phone login helpers and persists a session", async () => {
    process.env.TELEGRAM_API_ID = "1";
    process.env.TELEGRAM_API_HASH = "abc";
    const dir = mkdtempSync(join(tmpdir(), "tg-user-"));
    process.env.TELEGRAM_SESSION_PATH = join(dir, "user.session");

    const { client, server } = await connectClient(
      mockClient({ isAuthorized: async () => false }),
    );
    try {
      const start = await client.callTool({
        name: "start_login",
        arguments: { phone: "+15551234567" },
      });
      const startText = (start.content[0] as { text: string }).text;
      assert.equal(start.isError ?? false, false, startText);
      assert.match(startText, /complete_login/);

      const done = await client.callTool({
        name: "complete_login",
        arguments: { code: "12345" },
      });
      const doneText = (done.content[0] as { text: string }).text;
      assert.equal(done.isError ?? false, false, doneText);
      const parsed = JSON.parse(doneText) as {
        ok: boolean;
        session: string;
        me: UserInfo;
      };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.me.username, "ada");
      assert.ok(parsed.session.length > 20);
      assert.equal(doneText.includes(process.env.TELEGRAM_API_HASH ?? "nope"), false);
    } finally {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("start_qr_login returns a tg:// login URL", async () => {
    process.env.TELEGRAM_API_ID = "1";
    process.env.TELEGRAM_API_HASH = "abc";
    const dir = mkdtempSync(join(tmpdir(), "tg-user-"));
    process.env.TELEGRAM_SESSION_PATH = join(dir, "user.session");

    const { client, server } = await connectClient(
      mockClient({ isAuthorized: async () => false }),
    );
    try {
      const start = await client.callTool({
        name: "start_qr_login",
        arguments: {},
      });
      // The scannable image leads the result now, so read the text block.
      const content = start.content as { type: string; text?: string }[];
      const text = content.find((c) => c.type === "text")?.text ?? "";
      assert.equal(start.isError ?? false, false, text);
      assert.match(text, /tg:\/\/login\?token=/);
      assert.equal(content[0]?.type, "image");
    } finally {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
