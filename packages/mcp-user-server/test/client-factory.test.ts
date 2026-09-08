import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createGramJsUserClient } from "../src/client.js";

const keys = [
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "TELEGRAM_SESSION",
  "TELEGRAM_SESSION_PATH",
];

afterEach(() => {
  for (const key of keys) delete process.env[key];
});

function withCredentials(): string {
  const dir = mkdtempSync(join(tmpdir(), "tg-factory-"));
  process.env.TELEGRAM_API_ID = "12345";
  process.env.TELEGRAM_API_HASH = "deadbeefdeadbeefdeadbeefdeadbeef";
  process.env.TELEGRAM_SESSION_PATH = join(dir, "user.session");
  return dir;
}

// Regression test for a real failure: the server passed the resumed session
// into createClient, but the default factory took no arguments and silently
// dropped it, so a restarted process built a fresh auth key and Telegram
// answered PHONE_CODE_EXPIRED. The unit tests missed it because the injected
// mock ignored the argument too.
describe("createGramJsUserClient session source", () => {
  it("passes the resumed session to StringSession", () => {
    const dir = withCredentials();
    try {
      assert.doesNotThrow(() => createGramJsUserClient());
      // StringSession is what rejects this, so throwing proves the argument
      // reached it rather than being dropped on the floor.
      assert.throws(
        () => createGramJsUserClient("not-a-session"),
        /Not a valid string/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers the resumed session over the session file", () => {
    const dir = withCredentials();
    try {
      writeFileSync(join(dir, "user.session"), "not-a-session", "utf8");
      // Reading the file is what would fail here...
      assert.throws(() => createGramJsUserClient(), /Not a valid string/);
      // ...so getting through means the argument was used instead.
      assert.doesNotThrow(() => createGramJsUserClient(""));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
