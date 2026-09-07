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

const SECRET_SHAPED =
  /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b|[a-f0-9]{32}|[A-Za-z0-9+/_-]{80,}/;

const plugin = mustJson(".cursor-plugin/plugin.json");
if (plugin) {
  if (plugin.name !== "telegram-bot") {
    errors.push(`plugin name must be telegram-bot, got ${plugin.name}`);
  }
  if (plugin.version !== "0.3.0") {
    errors.push(`plugin version must be 0.3.0, got ${plugin.version}`);
  }
  if (plugin.license !== "MIT") {
    errors.push("plugin license must be MIT");
  }
  const keywords = plugin.keywords ?? [];
  for (const k of ["telegram", "messaging", "bot", "mcp", "mtproto", "user-account"]) {
    if (!keywords.includes(k)) errors.push(`missing keyword: ${k}`);
  }
  if (!plugin.author?.name) errors.push("author.name is required");
  const vars = plugin.variables;
  if (vars?.type !== "object") {
    errors.push("variables must be a JSON Schema object");
  } else {
    for (const name of [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_API_ID",
      "TELEGRAM_API_HASH",
      "TELEGRAM_SESSION",
    ]) {
      if (!vars.properties?.[name]) {
        errors.push(`variables must declare ${name}`);
      }
    }
    if (vars.required?.includes("TELEGRAM_BOT_TOKEN")) {
      errors.push(
        "TELEGRAM_BOT_TOKEN must not be required so user-account-only installs work",
      );
    }
  }
  if (plugin.logo && !existsSync(join(root, plugin.logo))) {
    errors.push(`logo path not found: ${plugin.logo}`);
  }
  const pluginRaw = JSON.stringify(plugin);
  if (SECRET_SHAPED.test(pluginRaw) && pluginRaw.includes(":AAH")) {
    errors.push("plugin.json appears to contain a secret");
  }
}

const mcp = mustJson("mcp.json");
if (mcp) {
  const bot = mcp.mcpServers?.["telegram-bot"];
  const user = mcp.mcpServers?.["telegram-user"];
  if (!bot) errors.push("mcp.json must define mcpServers.telegram-bot");
  else {
    const env = JSON.stringify(bot.env ?? {});
    const args = JSON.stringify(bot.args ?? []);
    if (!env.includes("${TELEGRAM_BOT_TOKEN}")) {
      errors.push("telegram-bot must pass ${TELEGRAM_BOT_TOKEN} into the server env");
    }
    if (env.includes("123456789:") || /:\s*"[0-9]{6,}:/.test(env)) {
      errors.push("mcp.json appears to contain a real bot token");
    }
    if (bot.command !== "npx") {
      errors.push("telegram-bot must launch via npx (marketplace must not depend on a Desktop clone)");
    }
    if (!args.includes("-y") || !args.includes("cursor-telegram-bot-mcp")) {
      errors.push("telegram-bot must use npx -y cursor-telegram-bot-mcp");
    }
    if (args.includes("${PLUGIN_ROOT}") || args.includes("packages/mcp-server")) {
      errors.push("telegram-bot must not launch a local PLUGIN_ROOT dist path");
    }
  }
  if (!user) errors.push("mcp.json must define mcpServers.telegram-user");
  else {
    const env = JSON.stringify(user.env ?? {});
    const args = JSON.stringify(user.args ?? []);
    for (const placeholder of [
      "${TELEGRAM_API_ID}",
      "${TELEGRAM_API_HASH}",
      "${TELEGRAM_SESSION}",
    ]) {
      if (!env.includes(placeholder)) {
        errors.push(`telegram-user must pass ${placeholder} into the server env`);
      }
    }
    if (user.command !== "npx") {
      errors.push("telegram-user must launch via npx (marketplace must not depend on a Desktop clone)");
    }
    if (!args.includes("-y") || !args.includes("cursor-telegram-user-mcp")) {
      errors.push("telegram-user must use npx -y cursor-telegram-user-mcp");
    }
    if (args.includes("${PLUGIN_ROOT}") || args.includes("packages/mcp-user-server")) {
      errors.push("telegram-user must not launch a local PLUGIN_ROOT dist path");
    }
  }
  if (SECRET_SHAPED.test(JSON.stringify(mcp)) && JSON.stringify(mcp).includes(":AAH")) {
    errors.push("mcp.json appears to contain a secret");
  }
}

const skillFiles = [
  "skills/send-telegram-message/SKILL.md",
  "skills/telegram-bot-setup/SKILL.md",
  "skills/telegram-user-setup/SKILL.md",
  "skills/send-telegram-user-message/SKILL.md",
  "skills/telegram-mode-guide/SKILL.md",
];
for (const rel of skillFiles) {
  const raw = read(rel);
  if (raw == null) continue;
  if (!raw.startsWith("---")) errors.push(`${rel} needs YAML frontmatter`);
  if (!/^name:\s+[a-z0-9-]+/m.test(raw)) errors.push(`${rel} missing name`);
  if (!/^description:\s+\S/m.test(raw)) errors.push(`${rel} missing description`);
}

for (const rel of [
  "README.md",
  "LICENSE",
  "packages/mcp-server/dist/index.js",
  "packages/mcp-user-server/dist/index.js",
  "packages/mcp-server/LICENSE",
  "packages/mcp-user-server/LICENSE",
  "packages/mcp-server/README.md",
  "packages/mcp-user-server/README.md",
]) {
  read(rel);
}

function mustPublishable(rel, expectedName, binName) {
  const pkg = mustJson(rel);
  if (!pkg) return;
  if (pkg.private) errors.push(`${rel} must not be private (publish-ready)`);
  if (pkg.name !== expectedName) errors.push(`${rel} name must be ${expectedName}, got ${pkg.name}`);
  if (pkg.license !== "MIT") errors.push(`${rel} license must be MIT`);
  if (!pkg.bin?.[binName]) errors.push(`${rel} must declare bin.${binName}`);
  if (!pkg.files?.includes("dist")) errors.push(`${rel} files must include dist`);
  if (!pkg.engines?.node) errors.push(`${rel} must declare engines.node`);
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!String(repo ?? "").includes("github.com/Lotus015/cursor-telegram-plugin")) {
    errors.push(`${rel} repository must point at https://github.com/Lotus015/cursor-telegram-plugin`);
  }
  if (pkg.version !== "0.3.0") errors.push(`${rel} version must be 0.3.0, got ${pkg.version}`);
}

mustPublishable("packages/mcp-server/package.json", "cursor-telegram-bot-mcp", "cursor-telegram-bot-mcp");
mustPublishable(
  "packages/mcp-user-server/package.json",
  "cursor-telegram-user-mcp",
  "cursor-telegram-user-mcp",
);

const readme = read("README.md") ?? "";
if (!readme.includes("Grok Bot")) {
  errors.push("README.md must have a Grok Bot / easy install section");
}
if (!readme.includes("npx -y cursor-telegram-bot-mcp")) {
  errors.push("README.md must document npx -y cursor-telegram-bot-mcp");
}
if (!readme.includes("npx -y cursor-telegram-user-mcp")) {
  errors.push("README.md must document npx -y cursor-telegram-user-mcp");
}

if (errors.length) {
  console.error("Plugin validation failed:");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log("Plugin validation passed.");
