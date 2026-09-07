import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as {
  name: string;
  private?: boolean;
  license?: string;
  bin?: Record<string, string>;
  files?: string[];
  engines?: { node?: string };
  repository?: { url?: string } | string;
};

describe("publish config", () => {
  it("is an npx-publishable package with no secrets", () => {
    assert.equal(pkg.private, undefined);
    assert.equal(pkg.name, "cursor-telegram-bot-mcp");
    assert.equal(pkg.license, "MIT");
    assert.equal(pkg.bin?.["cursor-telegram-bot-mcp"], "dist/index.js");
    assert.ok(pkg.files?.includes("dist"));
    assert.ok(pkg.engines?.node?.includes("20"));
    const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    assert.match(String(repo), /github\.com\/Lotus015\/cursor-telegram-plugin/);
    assert.doesNotMatch(JSON.stringify(pkg), /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/);
  });
});
