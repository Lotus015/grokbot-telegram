import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getBotToken,
  getMe,
  sendMessage,
  TelegramApiError,
} from "../src/telegram.js";

const TOKEN = "123456789:AAHfakeTokenValueForTestsOnly1234567";

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe("getBotToken", () => {
  it("requires a real token", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.throws(() => getBotToken(), /missing/);
    process.env.TELEGRAM_BOT_TOKEN = "${TELEGRAM_BOT_TOKEN}";
    assert.throws(() => getBotToken(), /placeholder/);
  });

  it("trims a valid token", () => {
    process.env.TELEGRAM_BOT_TOKEN = ` ${TOKEN} `;
    assert.equal(getBotToken(), TOKEN);
  });
});

describe("telegramMethod", () => {
  it("calls getMe and never puts the token in thrown errors", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const original = globalThis.fetch;
    let calledUrl = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrl = String(input);
      return new Response(
        JSON.stringify({
          ok: true,
          result: { id: 1, is_bot: true, username: "demo_bot" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const me = await getMe();
      assert.equal((me as { username: string }).username, "demo_bot");
      assert.match(calledUrl, new RegExp(`/bot${TOKEN}/getMe`));
    } finally {
      globalThis.fetch = original;
    }
  });

  it("surfaces Telegram errors without the token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 401,
          description: `Unauthorized: ${TOKEN}`,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      await sendMessage({ chat_id: 1, text: "hi" });
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof TelegramApiError);
      assert.equal(err.errorCode, 401);
      assert.equal(err.message.includes(TOKEN), false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("posts sendMessage with parse_mode", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const original = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 42, chat: { id: 1, type: "private" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const result = await sendMessage({
        chat_id: "@publicchannel",
        text: "hello",
        parse_mode: "HTML",
      });
      assert.equal((result as { message_id: number }).message_id, 42);
      const parsed = JSON.parse(body) as {
        chat_id: string;
        text: string;
        parse_mode: string;
      };
      assert.equal(parsed.chat_id, "@publicchannel");
      assert.equal(parsed.parse_mode, "HTML");
    } finally {
      globalThis.fetch = original;
    }
  });
});
