import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  apiCredentialsPath,
  apiCredentialsSource,
  getUserApiCredentials,
  readStoredApiCredentials,
  writeApiCredentials,
} from "../src/credentials.js";
import { createTelegramUserMcpServer } from "../src/server.js";
import type { TelegramUserClient } from "../src/types.js";

const HASH = "deadbeefdeadbeefdeadbeefdeadbeef";
const keys = [
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "TELEGRAM_SESSION",
  "TELEGRAM_SESSION_PATH",
];

afterEach(() => {
  for (const key of keys) delete process.env[key];
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "tg-creds-"));
  process.env.TELEGRAM_SESSION_PATH = join(dir, "user.session");
  return dir;
}

describe("stored api credentials", () => {
  it("round-trips beside the session file at 0600", () => {
    const dir = tempHome();
    try {
      const path = writeApiCredentials({ apiId: 12345, apiHash: HASH });
      assert.equal(path, apiCredentialsPath());
      assert.equal(path, join(dir, "api-credentials.json"));
      // api_hash is a secret, so the file must not be world-readable.
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.deepEqual(readStoredApiCredentials(), { apiId: 12345, apiHash: HASH });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the stored pair when the environment has none", () => {
    const dir = tempHome();
    try {
      assert.throws(() => getUserApiCredentials(), /TELEGRAM_API_ID is missing/);
      writeApiCredentials({ apiId: 777, apiHash: HASH });
      assert.deepEqual(getUserApiCredentials(), { apiId: 777, apiHash: HASH });
      assert.equal(apiCredentialsSource(), "file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets the environment win, so a host's own config still overrides", () => {
    const dir = tempHome();
    try {
      writeApiCredentials({ apiId: 777, apiHash: HASH });
      process.env.TELEGRAM_API_ID = "999";
      process.env.TELEGRAM_API_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      assert.deepEqual(getUserApiCredentials(), {
        apiId: 999,
        apiHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      assert.equal(apiCredentialsSource(), "env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a corrupt or half-written file rather than throwing", () => {
    const dir = tempHome();
    try {
      for (const contents of ["", "{", '{"apiId":0,"apiHash":"x"}', '{"apiId":5}']) {
        writeFileSync(apiCredentialsPath(), contents, "utf8");
        assert.equal(readStoredApiCredentials(), null);
        assert.equal(apiCredentialsSource(), "none");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("save_api_credentials tool", () => {
  const stub: TelegramUserClient = {
    connect: async () => {},
    disconnect: async () => {},
    isAuthorized: async () => false,
    getMe: async () => ({ id: "1", isBot: false }),
    listDialogs: async () => [],
    listForumTopics: async () => [],
    getMessages: async () => [],
    sendMessage: async (chat: string, text: string) => ({ id: 1, chatId: chat, text }),
    sendCode: async () => ({ phoneCodeHash: "h", isCodeViaApp: true }),
    signIn: async () => ({ id: "1", isBot: false }),
    signInWithPassword: async () => ({ id: "1", isBot: false }),
    exportLoginToken: async () => ({ kind: "token" as const, token: Buffer.from("t"), expires: 1 }),
    importLoginToken: async () => ({ kind: "success" as const, user: { id: "1", isBot: false } }),
    switchDc: async () => {},
    onLoginToken: () => () => {},
    exportSession: () => "s",
  };

  async function call(args: Record<string, unknown>) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createTelegramUserMcpServer({ createClient: () => stub });
    const mcp = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      mcp.connect(clientTransport),
    ]);
    const result = await mcp.callTool({ name: "save_api_credentials", arguments: args });
    const text = (result.content[0] as { text: string }).text;
    await mcp.close();
    await server.close();
    return { isError: result.isError ?? false, text };
  }

  it("saves the pair and never echoes the hash back", async () => {
    const dir = tempHome();
    try {
      const { isError, text } = await call({ api_id: "12345", api_hash: HASH });
      assert.equal(isError, false, text);
      assert.equal(
        text.includes(HASH),
        false,
        "the tool echoed api_hash back into the conversation",
      );
      assert.match(text, /12345/);
      assert.deepEqual(readStoredApiCredentials(), { apiId: 12345, apiHash: HASH });
      assert.equal(readFileSync(apiCredentialsPath(), "utf8").includes(HASH), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a mistyped pair where the mistake is, not at login time", async () => {
    const dir = tempHome();
    try {
      const short = await call({ api_id: "12345", api_hash: "deadbeef" });
      assert.equal(short.isError, true);
      assert.match(short.text, /32 hexadecimal/);

      // The classic paste error: the two values swapped.
      const swapped = await call({ api_id: HASH, api_hash: "12345" });
      assert.equal(swapped.isError, true);
      assert.match(swapped.text, /positive integer/);

      assert.equal(readStoredApiCredentials(), null, "a bad pair was still written");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
