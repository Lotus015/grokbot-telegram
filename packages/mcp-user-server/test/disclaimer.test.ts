import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DISCLAIMER,
  DisclaimerOverflowError,
  TELEGRAM_TEXT_LIMIT,
  applyDisclaimer,
  disclaimerText,
} from "../src/disclaimer.js";

describe("user disclaimer", () => {
  it("says the message was sent on the account owner's behalf", () => {
    assert.match(DEFAULT_DISCLAIMER, /on my behalf/);
    // The footer names the package so a recipient can find it by searching.
    assert.match(DEFAULT_DISCLAIMER, /grokbot-telegram/);
    // No URL: Telegram would attach a link-preview card to every message.
    assert.equal(/https?:\/\//.test(DEFAULT_DISCLAIMER), false);
    assert.equal(
      applyDisclaimer("hi", {}),
      `hi\n\n${DEFAULT_DISCLAIMER}`,
    );
  });

  it("uses custom wording when TELEGRAM_DISCLAIMER is set", () => {
    assert.equal(
      applyDisclaimer("hi", { TELEGRAM_DISCLAIMER: "-- poslao agent" }),
      "hi\n\n-- poslao agent",
    );
  });

  it("drops the footer for every off-switch spelling", () => {
    for (const value of ["off", "OFF", "false", "0", "no", "none", " off "]) {
      assert.equal(
        applyDisclaimer("hi", { TELEGRAM_DISCLAIMER: value }),
        "hi",
        `expected ${JSON.stringify(value)} to disable the footer`,
      );
      assert.equal(disclaimerText({ TELEGRAM_DISCLAIMER: value }), null);
    }
  });

  it("ignores an unsubstituted Cursor plugin placeholder", () => {
    assert.equal(
      disclaimerText({ TELEGRAM_DISCLAIMER: "${TELEGRAM_DISCLAIMER}" }),
      DEFAULT_DISCLAIMER,
    );
  });

  it("refuses to send when the footer would blow the length limit", () => {
    const text = "x".repeat(TELEGRAM_TEXT_LIMIT);
    assert.throws(
      () => applyDisclaimer(text, {}),
      (err: unknown) => {
        assert.ok(err instanceof DisclaimerOverflowError);
        assert.equal(err.overflow, DEFAULT_DISCLAIMER.length + 2);
        return true;
      },
    );
  });

  it("still sends a message that exactly fits with the footer", () => {
    const room = TELEGRAM_TEXT_LIMIT - DEFAULT_DISCLAIMER.length - 2;
    assert.equal(applyDisclaimer("x".repeat(room), {}).length, TELEGRAM_TEXT_LIMIT);
  });
});
