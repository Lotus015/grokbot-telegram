import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { pendingLoginPath, writePendingLogin } from "../src/pending-login.js";
import { createTelegramUserMcpServer } from "../src/server.js";
import type { LoginTokenResult, TelegramUserClient } from "../src/types.js";

const keys = [
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "TELEGRAM_SESSION",
  "TELEGRAM_SESSION_PATH",
];

afterEach(() => {
  for (const key of keys) delete process.env[key];
});

const me = { id: "7", username: "ada", isBot: false };

type Calls = { exports: number; imports: number };

function qrClient(
  opts: {
    authorized?: boolean;
    tokens?: LoginTokenResult[];
    importThrows?: unknown;
  },
  calls: Calls,
): TelegramUserClient {
  const queue = [...(opts.tokens ?? [])];
  return {
    connect: async () => {},
    disconnect: async () => {},
    isAuthorized: async () => opts.authorized === true,
    getMe: async () => me,
    listDialogs: async () => [],
    getMessages: async () => [],
    sendMessage: async (chat: string, text: string) => ({ id: 1, chatId: chat, text }),
    sendCode: async () => ({ phoneCodeHash: "h", isCodeViaApp: true }),
    signIn: async () => me,
    signInWithPassword: async () => me,
    exportLoginToken: async () => {
      calls.exports += 1;
      const next = queue.shift();
      if (next === undefined) throw new Error("mock ran out of login tokens");
      return next;
    },
    importLoginToken: async () => {
      calls.imports += 1;
      if (opts.importThrows !== undefined) throw opts.importThrows;
      return { kind: "success" as const, user: me };
    },
    switchDc: async () => {},
    onLoginToken: () => () => {},
    exportSession: () => "resumed-pre-auth-session",
  };
}

async function connect(client: TelegramUserClient) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createTelegramUserMcpServer({ createClient: () => client });
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    mcp.connect(clientTransport),
  ]);
  return { mcp, server };
}

function resumingProcess(): { dir: string; sessionPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "tg-qr-"));
  const sessionPath = join(dir, "user.session");
  process.env.TELEGRAM_SESSION_PATH = sessionPath;
  process.env.TELEGRAM_API_ID = "12345";
  process.env.TELEGRAM_API_HASH = "deadbeefdeadbeefdeadbeefdeadbeef";
  // A QR login started in a process that is now gone.
  writePendingLogin({
    kind: "qr",
    session: "resumed-pre-auth-session",
    startedAtMs: Date.now(),
  });
  return { dir, sessionPath };
}

async function callComplete(client: TelegramUserClient) {
  const { mcp, server } = await connect(client);
  const result = await mcp.callTool({
    name: "complete_qr_login",
    arguments: { wait_ms: 0 },
  });
  const text = (result.content[0] as { text: string }).text;
  await mcp.close();
  await server.close();
  return { isError: result.isError ?? false, text };
}

describe("QR login resumed in another process", () => {
  it("adopts an authorization that landed while the process was gone", async () => {
    const { dir, sessionPath } = resumingProcess();
    const calls: Calls = { exports: 0, imports: 0 };
    try {
      // The phone scanned while nothing was listening. There is no update to
      // receive and no token left to redeem — but the auth key is authorized.
      const { isError, text } = await callComplete(qrClient({ authorized: true }, calls));
      assert.equal(isError, false, text);

      const parsed = JSON.parse(text) as { ok: boolean; me: { username: string } };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.me.username, "ada");

      // No token dance was needed or attempted.
      assert.equal(calls.exports, 0);
      assert.equal(calls.imports, 0);

      assert.equal(readFileSync(sessionPath, "utf8"), "resumed-pre-auth-session");
      assert.equal(existsSync(pendingLoginPath()), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hands over a fresh code when the old token expired mid-migrate", async () => {
    const { dir } = resumingProcess();
    const calls: Calls = { exports: 0, imports: 0 };
    try {
      const expired = Object.assign(new Error("AUTH_TOKEN_EXPIRED"), {
        errorMessage: "AUTH_TOKEN_EXPIRED",
      });
      const { isError, text } = await callComplete(
        qrClient(
          {
            authorized: false,
            importThrows: expired,
            tokens: [
              { kind: "migrate", dcId: 4, token: Buffer.from("old") },
              { kind: "token", token: Buffer.from("brand-new"), expires: 99 },
            ],
          },
          calls,
        ),
      );

      // An expired token is an ordinary outcome, not a tool error.
      assert.equal(isError, false, text);
      const parsed = JSON.parse(text) as {
        ok: boolean;
        waiting: boolean;
        login_url?: string;
        note: string;
      };
      assert.equal(parsed.ok, false);
      assert.equal(parsed.waiting, true);
      assert.equal(calls.imports, 1);

      // The caller must be told the earlier QR is dead and given the new one,
      // otherwise it sends the user back to a code that can never complete.
      assert.ok(parsed.login_url, `no fresh login_url in ${text}`);
      assert.match(parsed.note, /NEW QR code/);
      assert.equal(calls.exports, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the new code even without a migrate step", async () => {
    const { dir } = resumingProcess();
    const calls: Calls = { exports: 0, imports: 0 };
    try {
      const { text } = await callComplete(
        qrClient(
          {
            authorized: false,
            tokens: [{ kind: "token", token: Buffer.from("fresh"), expires: 42 }],
          },
          calls,
        ),
      );
      const parsed = JSON.parse(text) as { login_url?: string; expires?: number };
      assert.ok(parsed.login_url, `no login_url in ${text}`);
      assert.equal(parsed.expires, 42);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
