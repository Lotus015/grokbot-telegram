import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactSecrets, safeErrorMessage } from "../src/redact.js";

const SAMPLE = "123456789:AAHfakeTokenValueForTestsOnly1234567";

describe("redactSecrets", () => {
  it("replaces an explicit token", () => {
    const leaked = `https://api.telegram.org/bot${SAMPLE}/sendMessage`;
    assert.equal(
      redactSecrets(leaked, SAMPLE).includes(SAMPLE),
      false,
    );
    assert.match(redactSecrets(leaked, SAMPLE), /redacted-bot-token/);
  });

  it("redacts token-shaped strings even without the explicit token", () => {
    const out = redactSecrets(`token=${SAMPLE} used`);
    assert.equal(out.includes(SAMPLE), false);
  });

  it("redacts /bot... path segments", () => {
    const out = redactSecrets("POST /botABC/getMe failed");
    assert.match(out, /\/bot\[redacted-bot-token\]/);
  });
});

describe("safeErrorMessage", () => {
  it("reads Error.message and redacts", () => {
    const err = new Error(`Unauthorized bot${SAMPLE}`);
    const out = safeErrorMessage(err, SAMPLE);
    assert.equal(out.includes(SAMPLE), false);
  });
});
