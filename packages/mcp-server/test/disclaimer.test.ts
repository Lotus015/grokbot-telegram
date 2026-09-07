import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DISCLAIMER,
  DisclaimerOverflowError,
  TELEGRAM_TEXT_LIMIT,
  applyDisclaimer,
  disclaimerText,
  escapeForParseMode,
} from "../src/disclaimer.js";

describe("bot disclaimer", () => {
  it("appends the default footer when the env var is unset", () => {
    assert.equal(
      applyDisclaimer("hi", undefined, {}),
      `hi\n\n${DEFAULT_DISCLAIMER}`,
    );
  });

  it("uses custom wording when TELEGRAM_DISCLAIMER is set", () => {
    assert.equal(
      applyDisclaimer("hi", undefined, { TELEGRAM_DISCLAIMER: "-- via robot" }),
      "hi\n\n-- via robot",
    );
  });

  it("drops the footer for every off-switch spelling", () => {
    for (const value of ["off", "OFF", "false", "0", "no", "none", " off "]) {
      assert.equal(
        applyDisclaimer("hi", undefined, { TELEGRAM_DISCLAIMER: value }),
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

  it("escapes the footer for MarkdownV2 so Telegram does not reject it", () => {
    const sent = applyDisclaimer("*bold*", "MarkdownV2", {});
    // A bare "." or "-" is a syntax error in MarkdownV2.
    assert.equal(sent.includes("\\."), true);
    assert.equal(/(?<!\\)\.$/.test(sent), false);
    assert.equal(sent.startsWith("*bold*\n\n"), true);
  });

  it("escapes the footer for HTML and legacy Markdown", () => {
    assert.equal(
      escapeForParseMode("a <b> & c", "HTML"),
      "a &lt;b&gt; &amp; c",
    );
    assert.equal(escapeForParseMode("_x_ *y*", "Markdown"), "\\_x\\_ \\*y\\*");
    assert.equal(escapeForParseMode("a. b-c", undefined), "a. b-c");
  });

  it("refuses to send when the footer would blow the length limit", () => {
    const text = "x".repeat(TELEGRAM_TEXT_LIMIT);
    assert.throws(
      () => applyDisclaimer(text, undefined, {}),
      (err: unknown) => {
        assert.ok(err instanceof DisclaimerOverflowError);
        assert.equal(err.overflow, DEFAULT_DISCLAIMER.length + 2);
        assert.match(err.message, /over Telegram's 4096-character limit/);
        return true;
      },
    );
  });

  it("still sends a message that exactly fits with the footer", () => {
    const room = TELEGRAM_TEXT_LIMIT - DEFAULT_DISCLAIMER.length - 2;
    const text = "x".repeat(room);
    assert.equal(applyDisclaimer(text, undefined, {}).length, TELEGRAM_TEXT_LIMIT);
  });
});
