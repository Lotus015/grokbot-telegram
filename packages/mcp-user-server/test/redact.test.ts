import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactSecrets, safeErrorMessage } from "../src/redact.js";

const HASH = "abcdef0123456789abcdef0123456789";
const SESSION = "A".repeat(96);
const TOKEN = "123456789:AAHfakeTokenValueForTestsOnly1234567";

describe("user redactSecrets", () => {
  it("redacts api_hash, session-like strings, and bot tokens", () => {
    const leaked = `hash=${HASH} session=${SESSION} token=${TOKEN}`;
    const out = redactSecrets(leaked, [HASH, SESSION]);
    assert.equal(out.includes(HASH), false);
    assert.equal(out.includes(SESSION), false);
    assert.equal(out.includes(TOKEN), false);
  });

  it("safeErrorMessage reads Error.message", () => {
    const err = new Error(`bad ${HASH}`);
    const out = safeErrorMessage(err, [HASH]);
    assert.equal(out.includes(HASH), false);
  });
});
