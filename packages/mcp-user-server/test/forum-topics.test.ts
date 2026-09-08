import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { ForumTopicSummary } from "../src/dialogs.js";
import { createTelegramUserMcpServer } from "../src/server.js";
import type { TelegramUserClient } from "../src/types.js";

let isolated: string | undefined;

beforeEach(() => {
  isolated = mkdtempSync(join(tmpdir(), "tg-forum-"));
  process.env.TELEGRAM_SESSION_PATH = join(isolated, "user.session");
  process.env.TELEGRAM_API_ID = "12345";
  process.env.TELEGRAM_API_HASH = "deadbeefdeadbeefdeadbeefdeadbeef";
});

afterEach(() => {
  if (isolated !== undefined) rmSync(isolated, { recursive: true, force: true });
  isolated = undefined;
  for (const key of [
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
    "TELEGRAM_SESSION",
    "TELEGRAM_SESSION_PATH",
  ]) {
    delete process.env[key];
  }
});

const TOPICS: ForumTopicSummary[] = [
  { id: 1, title: "General" },
  { id: 42, title: "Judging", unreadCount: 3 },
  { id: 77, title: "Archive", closed: true },
];

type Seen = {
  sends: { chat: string; topicId?: number }[];
  reads: { chat: string; topicId?: number }[];
  topicCalls: number;
};

function forumClient(seen: Seen, topics: ForumTopicSummary[] = TOPICS): TelegramUserClient {
  const me = { id: "1", isBot: false };
  return {
    connect: async () => {},
    disconnect: async () => {},
    isAuthorized: async () => true,
    getMe: async () => me,
    listDialogs: async () => [
      {
        id: "-1004298194410",
        title: "Grok Bot Serbia Hackathon",
        type: "group" as const,
        isForum: true,
      },
    ],
    listForumTopics: async () => {
      seen.topicCalls += 1;
      return topics;
    },
    getMessages: async (chat: string, _limit: number, topicId?: number) => {
      seen.reads.push({ chat, topicId });
      return [{ id: 1, text: "hi" }];
    },
    sendMessage: async (chat: string, text: string, topicId?: number) => {
      seen.sends.push({ chat, topicId });
      return { id: 9, chatId: chat, text };
    },
    sendCode: async () => ({ phoneCodeHash: "h", isCodeViaApp: true }),
    signIn: async () => me,
    signInWithPassword: async () => me,
    exportLoginToken: async () => ({
      kind: "token" as const,
      token: Buffer.from("t"),
      expires: 1,
    }),
    importLoginToken: async () => ({ kind: "success" as const, user: me }),
    switchDc: async () => {},
    onLoginToken: () => () => {},
    exportSession: () => "s",
  };
}

async function call(
  client: TelegramUserClient,
  name: string,
  args: Record<string, unknown>,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createTelegramUserMcpServer({ createClient: () => client });
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    mcp.connect(clientTransport),
  ]);
  const result = await mcp.callTool({ name, arguments: args });
  const text = (result.content[0] as { text: string }).text;
  await mcp.close();
  await server.close();
  return { isError: result.isError ?? false, text };
}

function seen(): Seen {
  return { sends: [], reads: [], topicCalls: 0 };
}

describe("list_forum_topics", () => {
  it("returns topic ids and titles", async () => {
    const s = seen();
    const { isError, text } = await call(forumClient(s), "list_forum_topics", {
      chat: "-1004298194410",
    });
    assert.equal(isError, false, text);
    const parsed = JSON.parse(text) as { topics: ForumTopicSummary[]; count: number };
    assert.equal(parsed.count, 3);
    assert.deepEqual(
      parsed.topics.map((t) => [t.id, t.title]),
      [
        [1, "General"],
        [42, "Judging"],
        [77, "Archive"],
      ],
    );
  });

  it("explains an empty list instead of returning a bare zero", async () => {
    const s = seen();
    const { text } = await call(forumClient(s, []), "list_forum_topics", {
      chat: "-1004298194410",
    });
    const parsed = JSON.parse(text) as { count: number; note?: string };
    assert.equal(parsed.count, 0);
    assert.match(parsed.note ?? "", /does not have topics turned on/);
  });
});

describe("sending into a topic", () => {
  it("passes the topic id through once it is verified", async () => {
    const s = seen();
    const { isError, text } = await call(forumClient(s), "send_message", {
      chat: "-1004298194410",
      text: "hello",
      topic_id: 42,
    });
    assert.equal(isError, false, text);
    assert.deepEqual(s.sends, [{ chat: "-1004298194410", topicId: 42 }]);

    const parsed = JSON.parse(text) as { topic?: { id: number; title: string } };
    assert.deepEqual(parsed.topic, { id: 42, title: "Judging" });
  });

  // The whole reason verification exists: Telegram does not reject a bad
  // topic id, it files the message under General in front of the group.
  it("refuses an unknown topic id and sends nothing", async () => {
    const s = seen();
    const { isError, text } = await call(forumClient(s), "send_message", {
      chat: "-1004298194410",
      text: "hello",
      topic_id: 999,
    });
    assert.equal(isError, true);
    assert.match(text, /No topic with id 999/);
    // It has to name the real ones, or the caller cannot recover.
    assert.match(text, /Judging \(42\)/);
    assert.deepEqual(s.sends, [], "a message was sent to the wrong place");
  });

  it("refuses a closed topic", async () => {
    const s = seen();
    const { isError, text } = await call(forumClient(s), "send_message", {
      chat: "-1004298194410",
      text: "hello",
      topic_id: 77,
    });
    assert.equal(isError, true);
    assert.match(text, /closed/);
    assert.deepEqual(s.sends, []);
  });

  it("says to drop topic_id when the chat has no topics at all", async () => {
    const s = seen();
    const { isError, text } = await call(forumClient(s, []), "send_message", {
      chat: "-1004298194410",
      text: "hello",
      topic_id: 42,
    });
    assert.equal(isError, true);
    assert.match(text, /not a forum/);
    assert.deepEqual(s.sends, []);
  });

  it("costs nothing extra when no topic is named", async () => {
    const s = seen();
    const { isError } = await call(forumClient(s), "send_message", {
      chat: "-1004298194410",
      text: "hello",
    });
    assert.equal(isError, false);
    assert.deepEqual(s.sends, [{ chat: "-1004298194410", topicId: undefined }]);
    assert.equal(s.topicCalls, 0, "verified topics for a send that named none");
  });
});

describe("reading one topic", () => {
  it("passes topic_id through to the history read", async () => {
    const s = seen();
    const { isError, text } = await call(forumClient(s), "get_messages", {
      chat: "-1004298194410",
      topic_id: 42,
    });
    assert.equal(isError, false, text);
    assert.deepEqual(s.reads, [{ chat: "-1004298194410", topicId: 42 }]);
    assert.equal((JSON.parse(text) as { topic_id?: number }).topic_id, 42);
  });

  it("reads the whole chat when no topic is named", async () => {
    const s = seen();
    await call(forumClient(s), "get_messages", { chat: "-1004298194410" });
    assert.deepEqual(s.reads, [{ chat: "-1004298194410", topicId: undefined }]);
  });
});
