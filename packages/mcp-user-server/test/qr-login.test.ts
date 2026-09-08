import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  pendingLoginPath,
  readPendingLogin,
  writePendingLogin,
} from "../src/pending-login.js";
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
    sessionAfterSwitchDc?: string;
    captureLoginTokenListener?: (fire: () => void) => void;
  },
  calls: Calls,
): TelegramUserClient {
  const queue = [...(opts.tokens ?? [])];
  let session = "resumed-pre-auth-session";
  return {
    connect: async () => {},
    disconnect: async () => {},
    isAuthorized: async () => opts.authorized === true,
    getMe: async () => me,
    listDialogs: async () => [],
    listForumTopics: async () => [],
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
    switchDc: async () => {
      // A data centre switch means a fresh auth key, which is the whole
      // reason the persisted session has to be rewritten.
      if (opts.sessionAfterSwitchDc !== undefined) {
        session = opts.sessionAfterSwitchDc;
      }
    },
    onLoginToken: (listener: () => void) => {
      opts.captureLoginTokenListener?.(listener);
      return () => {};
    },
    exportSession: () => session,
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

type Content = { type: string; text?: string; data?: string; mimeType?: string };

function textOf(content: Content[]): string {
  const block = content.find((c) => c.type === "text");
  assert.ok(block?.text, `no text block in ${JSON.stringify(content.map((c) => c.type))}`);
  return block.text;
}

async function callComplete(client: TelegramUserClient) {
  const { mcp, server } = await connect(client);
  const result = await mcp.callTool({
    name: "complete_qr_login",
    arguments: { wait_ms: 0 },
  });
  const content = result.content as Content[];
  await mcp.close();
  await server.close();
  return { isError: result.isError ?? false, text: textOf(content), content };
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

  it("reports the remaining window as seconds, floored at zero", async () => {
    const { dir } = resumingProcess();
    const calls: Calls = { exports: 0, imports: 0 };
    try {
      const soon = Math.round(Date.now() / 1000) + 30;
      const live = await callComplete(
        qrClient(
          { authorized: false, tokens: [{ kind: "token", token: Buffer.from("t"), expires: soon }] },
          calls,
        ),
      );
      const parsed = JSON.parse(live.text) as { expires_in_seconds: number };
      // The caller needs a countdown, not a unix timestamp to subtract.
      assert.ok(
        parsed.expires_in_seconds >= 28 && parsed.expires_in_seconds <= 30,
        `expected ~30s, got ${parsed.expires_in_seconds}`,
      );

      const stale = await callComplete(
        qrClient(
          { authorized: false, tokens: [{ kind: "token", token: Buffer.from("t"), expires: 42 }] },
          { exports: 0, imports: 0 },
        ),
      );
      // A timestamp already in the past must not read as negative time left.
      assert.equal(
        (JSON.parse(stale.text) as { expires_in_seconds: number }).expires_in_seconds,
        0,
      );
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

describe("QR arrives as a scannable image", () => {
  it("leads the result with a PNG the user can point a camera at", async () => {
    const { dir } = resumingProcess();
    try {
      const { content } = await callComplete(
        qrClient(
          {
            authorized: false,
            tokens: [{ kind: "token", token: Buffer.from("scan-me"), expires: 99 }],
          },
          { exports: 0, imports: 0 },
        ),
      );

      // First, so a chat host paints it before anything else in the reply.
      const first = content[0];
      assert.equal(first?.type, "image");
      assert.equal(first?.mimeType, "image/png");

      const png = Buffer.from(first?.data ?? "", "base64");
      assert.ok(png.length > 100, `PNG too small: ${png.length} bytes`);
      assert.deepEqual(
        [...png.subarray(0, 4)],
        [0x89, 0x50, 0x4e, 0x47],
        "not a PNG signature",
      );

      // The link still travels as a fallback for hosts that show no images.
      const parsed = JSON.parse(textOf(content)) as { login_url: string };
      assert.match(parsed.login_url, /^tg:\/\/login\?token=/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still returns the login when the image cannot be built", async () => {
    const { dir } = resumingProcess();
    try {
      // An adopted session has no QR to draw; the result must stay well formed.
      const { isError, content } = await callComplete(
        qrClient({ authorized: true }, { exports: 0, imports: 0 }),
      );
      assert.equal(isError, false);
      assert.equal(content.some((c) => c.type === "image"), false);
      assert.equal((JSON.parse(textOf(content)) as { ok: boolean }).ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The failure this covers: the user scanned, Telegram listed the new device,
// then the process died — and the next one resumed a key nobody had
// authorized, because a data centre switch had replaced it in the meantime.
describe("the pending session follows the live auth key", () => {
  it("rewrites the pending file after a data centre switch", async () => {
    const { dir } = resumingProcess();
    try {
      const expired = Object.assign(new Error("AUTH_TOKEN_EXPIRED"), {
        errorMessage: "AUTH_TOKEN_EXPIRED",
      });
      await callComplete(
        qrClient(
          {
            authorized: false,
            importThrows: expired,
            sessionAfterSwitchDc: "session-on-the-new-dc",
            tokens: [
              { kind: "migrate", dcId: 4, token: Buffer.from("old") },
              { kind: "token", token: Buffer.from("new"), expires: 99 },
            ],
          },
          { exports: 0, imports: 0 },
        ),
      );

      const stored = readPendingLogin();
      assert.equal(
        stored?.session,
        "session-on-the-new-dc",
        "pending still holds the auth key from before the switch",
      );
      assert.equal(stored?.kind, "qr");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rewrites the pending file when the scan lands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-qr-scan-"));
    process.env.TELEGRAM_SESSION_PATH = join(dir, "user.session");
    process.env.TELEGRAM_API_ID = "12345";
    process.env.TELEGRAM_API_HASH = "deadbeefdeadbeefdeadbeefdeadbeef";
    try {
      let fireScan: (() => void) | undefined;
      const client = qrClient(
        {
          authorized: false,
          captureLoginTokenListener: (fire) => {
            fireScan = fire;
          },
          sessionAfterSwitchDc: "session-once-the-scan-landed",
          tokens: [{ kind: "token", token: Buffer.from("code"), expires: 99 }],
        },
        { exports: 0, imports: 0 },
      );

      const { mcp, server } = await connect(client);
      await mcp.callTool({ name: "start_qr_login", arguments: {} });
      assert.ok(fireScan, "no login-token listener was registered");

      // Telegram announces the scan on the live connection. If the process
      // dies right after this, disk must already hold the current key.
      const before = readPendingLogin()?.session;
      (client as unknown as { switchDc: () => Promise<void> }).switchDc();
      fireScan();

      const after = readPendingLogin()?.session;
      assert.equal(before, "resumed-pre-auth-session");
      assert.equal(
        after,
        "session-once-the-scan-landed",
        "the scan did not refresh the session held on disk",
      );

      await mcp.close();
      await server.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears the pending file when start_qr_login finds it already linked", async () => {
    const { dir } = resumingProcess();
    try {
      const client = qrClient(
        { authorized: false, tokens: [{ kind: "success", user: me }] },
        { exports: 0, imports: 0 },
      );
      const { mcp, server } = await connect(client);
      const started = await mcp.callTool({ name: "start_qr_login", arguments: {} });
      assert.equal(started.isError ?? false, false);

      // It persisted a real session, so the pre-auth key must not linger.
      assert.equal(existsSync(pendingLoginPath()), false);

      await mcp.close();
      await server.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
