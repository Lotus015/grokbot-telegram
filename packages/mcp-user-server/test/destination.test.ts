import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  DestinationError,
  classifyDestination,
  resolveTitle,
} from "../src/destination.js";
import type { DialogSummary } from "../src/dialogs.js";
import { createTelegramUserMcpServer } from "../src/server.js";
import type { TelegramUserClient } from "../src/types.js";

let isolated: string | undefined;

beforeEach(() => {
  isolated = mkdtempSync(join(tmpdir(), "tg-dest-"));
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

describe("classifyDestination", () => {
  it("sends ids, usernames and saved messages straight through", () => {
    for (const chat of ["me", "self", "SAVED", " me "]) {
      assert.deepEqual(classifyDestination(chat), { kind: "direct", target: "me" });
    }
    // Group and channel ids are negative.
    for (const chat of ["-5532867099", "777000", " -100123 "]) {
      assert.deepEqual(classifyDestination(chat), {
        kind: "direct",
        target: chat.trim(),
      });
    }
    // An explicit @ means the username namespace; take it at face value.
    for (const chat of ["@durov", "@some_channel"]) {
      assert.deepEqual(classifyDestination(chat), {
        kind: "direct",
        target: chat,
      });
    }
  });

  it("checks the user's own chats before assuming a bare word is a username", () => {
    // "Nowhere" is a valid username shape and also a plausible chat name.
    // Sending to a stranger who happens to hold it is the worse mistake, so
    // the dialog list wins and the username is only a fallback.
    for (const chat of ["durov", "Nowhere", "some_channel"]) {
      assert.deepEqual(classifyDestination(chat), {
        kind: "lookup",
        title: chat,
        usernameFallback: true,
      });
    }
  });

  it("treats anything that cannot be a username as a title", () => {
    // This is the case that used to be handed to GramJS raw, where it hunted
    // for a username that does not exist and hung until the host gave up.
    for (const chat of ["Holandija 2026", "Mama", "dev team ☕", "a-b"]) {
      assert.deepEqual(classifyDestination(chat), {
        kind: "lookup",
        title: chat.trim(),
        usernameFallback: false,
      });
    }
  });
});

describe("resolveTitle", () => {
  const dialogs: DialogSummary[] = [
    { id: "-5532867099", title: "Holandija 2026", type: "group" },
    { id: "-991", title: "Holandija 2026 — planning", type: "group" },
    { id: "7", title: "Ada", type: "user" },
  ];

  it("prefers an exact title over a longer one containing it", () => {
    assert.equal(resolveTitle(dialogs, "Holandija 2026")?.id, "-5532867099");
    assert.equal(resolveTitle(dialogs, "holandija 2026")?.id, "-5532867099");
  });

  it("resolves an unambiguous partial match", () => {
    assert.equal(resolveTitle(dialogs, "planning")?.id, "-991");
  });

  it("refuses to guess between candidates", () => {
    assert.throws(
      () => resolveTitle(dialogs, "Holandija"),
      (err: unknown) => {
        assert.ok(err instanceof DestinationError);
        assert.match(err.message, /2 chats match/);
        // The message has to be actionable: name them and their ids.
        assert.match(err.message, /-5532867099/);
        assert.match(err.message, /-991/);
        return true;
      },
    );
  });

  it("reports no match rather than deciding what it means", () => {
    // Whether a miss is an error or a username depends on the caller.
    assert.equal(resolveTitle(dialogs, "Nonexistent"), null);
  });
});

describe("send_message destination handling", () => {
  function client(seen: { targets: string[]; dialogCalls: number }): TelegramUserClient {
    const me = { id: "1", isBot: false };
    return {
      connect: async () => {},
      disconnect: async () => {},
      isAuthorized: async () => true,
      getMe: async () => me,
      listDialogs: async () => {
        seen.dialogCalls += 1;
        return [
          { id: "-5532867099", title: "Holandija 2026", type: "group" as const },
        ];
      },
      getMessages: async () => [],
      sendMessage: async (chat: string, text: string) => {
        seen.targets.push(chat);
        return { id: 1, chatId: chat, text };
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

  async function send(chat: string, seen: { targets: string[]; dialogCalls: number }) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createTelegramUserMcpServer({ createClient: () => client(seen) });
    const mcp = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      mcp.connect(clientTransport),
    ]);
    const result = await mcp.callTool({
      name: "send_message",
      arguments: { chat, text: "hello" },
    });
    const text = (result.content[0] as { text: string }).text;
    await mcp.close();
    await server.close();
    return { isError: result.isError ?? false, text };
  }

  it("sends to an id without touching the dialog list", async () => {
    const seen = { targets: [] as string[], dialogCalls: 0 };
    const { isError } = await send("-5532867099", seen);
    assert.equal(isError, false);
    assert.deepEqual(seen.targets, ["-5532867099"]);
    // The fast path must stay fast: no extra round trip.
    assert.equal(seen.dialogCalls, 0);
  });

  it("turns a title into an id before sending", async () => {
    const seen = { targets: [] as string[], dialogCalls: 0 };
    const { isError, text } = await send("Holandija 2026", seen);
    assert.equal(isError, false, text);
    // The title itself must never reach the Telegram client.
    assert.deepEqual(seen.targets, ["-5532867099"]);
    assert.equal(seen.dialogCalls, 1);
    const parsed = JSON.parse(text) as { resolved_chat?: { id: string; title: string } };
    assert.deepEqual(parsed.resolved_chat, {
      id: "-5532867099",
      title: "Holandija 2026",
    });
  });

  it("fails fast and usefully on a title that is not there", async () => {
    const seen = { targets: [] as string[], dialogCalls: 0 };
    // A space rules out a username, so a miss here can only be a mistake.
    const { isError, text } = await send("Nowhere At All", seen);
    assert.equal(isError, true, text);
    assert.match(text, /No chat named "Nowhere At All"/);
    assert.match(text, /list_dialogs/);
    assert.equal(seen.targets.length, 0, "a message went somewhere unintended");
  });

  it("falls back to a username when a bare word is not one of their chats", async () => {
    const seen = { targets: [] as string[], dialogCalls: 0 };
    const { isError } = await send("durov", seen);
    assert.equal(isError, false);
    assert.deepEqual(seen.targets, ["durov"]);
    // It still looked at their own chats first.
    assert.equal(seen.dialogCalls, 1);
  });

  it("prefers the user's own chat over a same-named username", async () => {
    const seen = { targets: [] as string[], dialogCalls: 0 };
    // The mock's dialog list contains no such title, so use one it does have
    // spelled as a bare word would be.
    const { isError, text } = await send("Holandija", seen);
    assert.equal(isError, false, text);
    assert.deepEqual(seen.targets, ["-5532867099"]);
  });
});

describe("get_messages destination handling", () => {
  it("reports what a title resolved to, the same way send_message does", async () => {
    const seen = { targets: [] as string[], dialogCalls: 0 };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createTelegramUserMcpServer({
      createClient: () => ({
        connect: async () => {},
        disconnect: async () => {},
        isAuthorized: async () => true,
        getMe: async () => ({ id: "1", isBot: false }),
        listDialogs: async () => {
          seen.dialogCalls += 1;
          return [
            { id: "-5532867099", title: "Holandija 2026", type: "group" as const },
          ];
        },
        getMessages: async (chat: string) => {
          seen.targets.push(chat);
          return [{ id: 1, text: "hi" }];
        },
        sendMessage: async (chat: string, text: string) => ({ id: 1, chatId: chat, text }),
        sendCode: async () => ({ phoneCodeHash: "h", isCodeViaApp: true }),
        signIn: async () => ({ id: "1", isBot: false }),
        signInWithPassword: async () => ({ id: "1", isBot: false }),
        exportLoginToken: async () => ({
          kind: "token" as const,
          token: Buffer.from("t"),
          expires: 1,
        }),
        importLoginToken: async () => ({
          kind: "success" as const,
          user: { id: "1", isBot: false },
        }),
        switchDc: async () => {},
        onLoginToken: () => () => {},
        exportSession: () => "s",
      }),
    });
    const mcp = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      mcp.connect(clientTransport),
    ]);

    const result = await mcp.callTool({
      name: "get_messages",
      arguments: { chat: "Holandija 2026" },
    });
    const text = (result.content[0] as { text: string }).text;
    assert.equal(result.isError ?? false, false, text);

    // The title must not reach the client, and the caller must be told which
    // chat it actually read — otherwise the two tools disagree about a
    // destination the user named the same way.
    assert.deepEqual(seen.targets, ["-5532867099"]);
    const parsed = JSON.parse(text) as {
      resolved_chat?: { id: string; title: string };
    };
    assert.deepEqual(parsed.resolved_chat, {
      id: "-5532867099",
      title: "Holandija 2026",
    });

    await mcp.close();
    await server.close();
  });
});
