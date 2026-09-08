import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  PENDING_TTL_MS,
  clearPendingLogin,
  pendingLoginPath,
  readPendingLogin,
  writePendingLogin,
} from "../src/pending-login.js";
import { createTelegramUserMcpServer } from "../src/server.js";
import type { TelegramUserClient } from "../src/types.js";

const keys = [
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "TELEGRAM_SESSION",
  "TELEGRAM_SESSION_PATH",
];

afterEach(() => {
  for (const key of keys) delete process.env[key];
});

function tempSession(): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "tg-pending-"));
  const env = { TELEGRAM_SESSION_PATH: join(dir, "user.session") };
  return { dir, env };
}

describe("pending login file", () => {
  it("round-trips and sits next to the session file, 0600", () => {
    const { dir, env } = tempSession();
    const path = writePendingLogin(
      {
        kind: "phone",
        session: "pre-auth-session",
        startedAtMs: Date.now(),
        phone: { phone: "+15551234567", phoneCodeHash: "hash1", isCodeViaApp: true },
      },
      env,
    );

    assert.equal(path, `${join(dir, "user.session")}.pending.json`);
    assert.equal(path, pendingLoginPath(env));
    // The file holds a pre-authorization auth key.
    assert.equal(statSync(path).mode & 0o777, 0o600);

    const read = readPendingLogin(Date.now(), env);
    assert.equal(read?.session, "pre-auth-session");
    assert.equal(read?.phone?.phoneCodeHash, "hash1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("discards and deletes an expired attempt", () => {
    const { dir, env } = tempSession();
    const startedAtMs = 1_000_000;
    const path = writePendingLogin(
      { kind: "phone", session: "s", startedAtMs }, env,
    );

    assert.notEqual(readPendingLogin(startedAtMs + PENDING_TTL_MS, env), null);
    assert.equal(readPendingLogin(startedAtMs + PENDING_TTL_MS + 1, env), null);
    // Not just hidden — an unusable auth key must not linger on disk.
    assert.equal(readPendingLogin(Date.now(), env), null);
    assert.throws(() => statSync(path));
    rmSync(dir, { recursive: true, force: true });
  });

  it("discards a corrupt or foreign file instead of throwing", () => {
    const { dir, env } = tempSession();
    for (const contents of ["not json at all", '{"kind":"nonsense"}', "{}"]) {
      writeFileSync(pendingLoginPath(env), contents, "utf8");
      assert.equal(readPendingLogin(Date.now(), env), null);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("clearing is safe when nothing is pending", () => {
    const { dir, env } = tempSession();
    assert.doesNotThrow(() => clearPendingLogin(env));
    rmSync(dir, { recursive: true, force: true });
  });
});

// The whole point: a one-shot MCP host runs start_login and complete_login in
// two different processes. Each server instance below stands for one process.
describe("login across a process restart", () => {
  function mockClient(sent: { signedIn: string[] }): TelegramUserClient {
    const me = { id: "7", username: "ada", isBot: false };
    return {
      connect: async () => {},
      disconnect: async () => {},
      isAuthorized: async () => false,
      getMe: async () => me,
      listDialogs: async () => [],
      getMessages: async () => [],
      sendMessage: async (chat: string, text: string) => ({
        id: 1,
        chatId: chat,
        text,
      }),
      sendCode: async () => ({ phoneCodeHash: "hash-from-process-1", isCodeViaApp: true }),
      signIn: async (phone: string, phoneCodeHash: string, phoneCode: string) => {
        sent.signedIn.push(`${phone}|${phoneCodeHash}|${phoneCode}`);
        return me;
      },
      signInWithPassword: async () => me,
      exportLoginToken: async () => ({
        kind: "token" as const,
        token: Buffer.from("qr"),
        expires: 1,
      }),
      importLoginToken: async () => ({ kind: "success" as const, user: me }),
      switchDc: async () => {},
      onLoginToken: () => () => {},
      exportSession: () => "pre-auth-session-from-process-1",
    };
  }

  async function connect(
    client: TelegramUserClient,
    handed: (string | undefined)[] = [],
  ) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createTelegramUserMcpServer({
      createClient: (session) => {
        handed.push(session);
        return client;
      },
    });
    const mcp = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      mcp.connect(clientTransport),
    ]);
    return { mcp, server };
  }

  it("redeems a code sent by a previous process", async () => {
    const { dir, env } = tempSession();
    Object.assign(process.env, env);
    process.env.TELEGRAM_API_ID = "12345";
    process.env.TELEGRAM_API_HASH = "deadbeefdeadbeefdeadbeefdeadbeef";
    const sent = { signedIn: [] as string[] };

    // Process 1 sends the code, then dies.
    const first = await connect(mockClient(sent));
    const started = await first.mcp.callTool({
      name: "start_login",
      arguments: { phone: "+15551234567" },
    });
    assert.equal(started.isError ?? false, false);
    await first.mcp.close();
    await first.server.close();

    const stored = readPendingLogin(Date.now(), env);
    assert.equal(stored?.phone?.phoneCodeHash, "hash-from-process-1");
    assert.equal(stored?.session, "pre-auth-session-from-process-1");

    // Process 2 knows nothing except what is on disk.
    const handed: (string | undefined)[] = [];
    const second = await connect(mockClient(sent), handed);
    const completed = await second.mcp.callTool({
      name: "complete_login",
      arguments: { code: "11111" },
    });
    const text = (completed.content[0] as { text: string }).text;
    assert.equal(completed.isError ?? false, false, text);

    // The hash came from the first process, not from a fresh sendCode.
    assert.deepEqual(sent.signedIn, ["+15551234567|hash-from-process-1|11111"]);

    // And the client was built on the auth key that requested the code. This
    // is the part the mock used to hide: the server passed a session the real
    // factory then ignored, and Telegram answered PHONE_CODE_EXPIRED.
    assert.deepEqual(handed, ["pre-auth-session-from-process-1"]);

    // A redeemed auth key must not stay on disk.
    assert.equal(readPendingLogin(Date.now(), env), null);
    const session = readFileSync(join(dir, "user.session"), "utf8");
    assert.equal(session, "pre-auth-session-from-process-1");

    await second.mcp.close();
    await second.server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("says the code expired rather than 'call start_login first'", async () => {
    const { dir, env } = tempSession();
    Object.assign(process.env, env);
    process.env.TELEGRAM_API_ID = "12345";
    process.env.TELEGRAM_API_HASH = "deadbeefdeadbeefdeadbeefdeadbeef";

    const { mcp, server } = await connect(mockClient({ signedIn: [] }));
    const completed = await mcp.callTool({
      name: "complete_login",
      arguments: { code: "11111" },
    });
    assert.equal(completed.isError, true);
    assert.match((completed.content[0] as { text: string }).text, /expired/i);

    await mcp.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
