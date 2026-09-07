#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function read(rel) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    errors.push(`Missing file: ${rel}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

function mustJson(rel) {
  const raw = read(rel);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    errors.push(`${rel} is not valid JSON: ${err.message}`);
    return null;
  }
}

const plugin = mustJson(".cursor-plugin/plugin.json");
if (plugin) {
  if (plugin.name !== "telegram-bot") {
    errors.push(`plugin name must be telegram-bot, got ${plugin.name}`);
  }
  if (plugin.version !== "0.1.0") {
    errors.push(`plugin version must be 0.1.0, got ${plugin.version}`);
  }
  if (plugin.license !== "MIT") {
    errors.push("plugin license must be MIT");
  }
  const keywords = plugin.keywords ?? [];
  for (const k of ["telegram", "messaging", "bot", "mcp"]) {
    if (!keywords.includes(k)) errors.push(`missing keyword: ${k}`);
  }
  if (!plugin.author?.name) errors.push("author.name is required");
  const vars = plugin.variables;
  if (vars?.type !== "object" || !vars.properties?.TELEGRAM_BOT_TOKEN) {
    errors.push("variables must declare TELEGRAM_BOT_TOKEN");
  } else if (!vars.required?.includes("TELEGRAM_BOT_TOKEN")) {
    errors.push("TELEGRAM_BOT_TOKEN must be required");
  }
  if (plugin.logo && !existsSync(join(root, plugin.logo))) {
    errors.push(`logo path not found: ${plugin.logo}`);
  }
}

const mcp = mustJson("mcp.json");
if (mcp) {
  const server = mcp.mcpServers?.["telegram-bot"];
  if (!server) errors.push("mcp.json must define mcpServers.telegram-bot");
  else {
    const env = JSON.stringify(server.env ?? {});
    const args = JSON.stringify(server.args ?? []);
    if (!env.includes("${TELEGRAM_BOT_TOKEN}")) {
      errors.push("mcp.json must pass ${TELEGRAM_BOT_TOKEN} into the server env");
    }
    if (env.includes("123456789:") || /:\s*"[0-9]{6,}:/.test(env)) {
      errors.push("mcp.json appears to contain a real token");
    }
    if (!args.includes("${PLUGIN_ROOT}") && !args.includes("packages/mcp-server")) {
      errors.push("mcp.json should launch the bundled server under packages/mcp-server");
    }
  }
}

const skillFiles = [
  "skills/send-telegram-message/SKILL.md",
  "skills/telegram-bot-setup/SKILL.md",
];
for (const rel of skillFiles) {
  const raw = read(rel);
  if (raw == null) continue;
  if (!raw.startsWith("---")) errors.push(`${rel} needs YAML frontmatter`);
  if (!/^name:\s+[a-z0-9-]+/m.test(raw)) errors.push(`${rel} missing name`);
  if (!/^description:\s+\S/m.test(raw)) errors.push(`${rel} missing description`);
}

for (const rel of ["README.md", "LICENSE", "packages/mcp-server/dist/index.js"]) {
  read(rel);
}

if (errors.length) {
  console.error("Plugin validation failed:");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log("Plugin validation passed.");
