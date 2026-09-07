#!/usr/bin/env node
// Collects the per-package esbuild bundles into the publishable root dist/.
import { chmodSync, copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const COPIES = [
  ["packages/mcp-server/dist/index.js", "bot.js"],
  ["packages/mcp-user-server/dist/index.js", "user.js"],
  ["packages/mcp-user-server/dist/login.js", "login.js"],
  ["src/cli.js", "cli.js"],
];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const [from, to] of COPIES) {
  const source = join(root, from);
  const target = join(dist, to);
  copyFileSync(source, target);
  console.log(`${from} -> dist/${to} (${(statSync(target).size / 1024).toFixed(0)} KB)`);
}

chmodSync(join(dist, "cli.js"), 0o755);
