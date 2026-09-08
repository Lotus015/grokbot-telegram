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
  if (!/^\d+\.\d+\.\d+$/.test(plugin.version ?? "")) {
    errors.push(`plugin version must be semver, got ${plugin.version}`);
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

const rootPkg = mustJson("package.json");
const PACKAGE_NAME = rootPkg?.name ?? "grokbot-telegram";
if (rootPkg) {
  if (rootPkg.private) {
    errors.push("root package.json must not be private — it is the published package");
  }
  if (rootPkg.publishConfig?.access !== "public") {
    errors.push('root package.json needs publishConfig.access = "public"');
  }
  if (rootPkg.type !== "module") {
    errors.push('root package.json needs "type": "module" so dist/*.js load as ESM');
  }
  if (!rootPkg.bin?.[PACKAGE_NAME]) {
    errors.push(`root package.json must expose a ${PACKAGE_NAME} bin`);
  }
  if (rootPkg.version !== plugin?.version) {
    errors.push(
      `package.json version (${rootPkg.version}) must match plugin.json (${plugin?.version})`,
    );
  }
}

// The user client reports this to Telegram, where it shows up in the account
// owner's device list. It drifted to 0.2.0 once already.
for (const rel of [
  "packages/mcp-server/src/server.ts",
  "packages/mcp-user-server/src/server.ts",
  "packages/mcp-user-server/src/client.ts",
]) {
  const raw = read(rel);
  if (raw == null) continue;
  const match = raw.match(/const VERSION = "([^"]+)"/);
  if (match == null) {
    errors.push(`${rel} declares no VERSION constant`);
  } else if (match[1] !== rootPkg?.version) {
    errors.push(
      `${rel} VERSION is ${match[1]}, expected ${rootPkg?.version} from package.json`,
    );
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
    if (bot.command !== "npx" || !args.includes(PACKAGE_NAME) || !args.includes('"bot"')) {
      errors.push(`telegram-bot should launch: npx -y ${PACKAGE_NAME} bot`);
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
    if (user.command !== "npx" || !args.includes(PACKAGE_NAME) || !args.includes('"user"')) {
      errors.push(`telegram-user should launch: npx -y ${PACKAGE_NAME} user`);
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
  "dist/cli.js",
  "dist/bot.js",
  "dist/user.js",
  "dist/login.js",
]) {
  read(rel);
}

if (errors.length) {
  console.error("Plugin validation failed:");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log("Plugin validation passed.");
