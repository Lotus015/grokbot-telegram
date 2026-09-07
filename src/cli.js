#!/usr/bin/env node
// grokbot-telegram: one entry point for both Telegram MCP servers.
//
// The servers themselves start on import (they call serveStdio at module
// scope), so dispatching is just an await import of the right bundle.

const MODES = new Map([
  ["bot", "./bot.js"],
  ["user", "./user.js"],
  ["login", "./login.js"],
]);

const USAGE = `grokbot-telegram <command>

Commands:
  bot     Telegram Bot API MCP server over stdio.
          Needs TELEGRAM_BOT_TOKEN.
  user    Telegram user-account (MTProto) MCP server over stdio.
          Needs TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION.
  login   Interactive login that prints a TELEGRAM_SESSION string.
          Needs TELEGRAM_API_ID and TELEGRAM_API_HASH.

Without a command the mode is read from the environment:
  TELEGRAM_BOT_TOKEN set                  -> bot
  TELEGRAM_API_ID + TELEGRAM_API_HASH set -> user

Examples:
  npx grokbot-telegram bot
  npx grokbot-telegram user
  npx grokbot-telegram login
`;

function isSet(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Returns a mode name, or an Error explaining why the environment is not
// enough to choose one.
export function detectMode(env) {
  const hasBot = isSet(env.TELEGRAM_BOT_TOKEN);
  const hasUser = isSet(env.TELEGRAM_API_ID) && isSet(env.TELEGRAM_API_HASH);

  if (hasBot && hasUser) {
    return new Error(
      "Both Bot API and user-account credentials are set, so the mode is ambiguous.\n" +
        "Pass one explicitly: grokbot-telegram bot  |  grokbot-telegram user",
    );
  }
  if (hasBot) return "bot";
  if (hasUser) return "user";
  return new Error(
    "No Telegram credentials found in the environment.\n" +
      "Set TELEGRAM_BOT_TOKEN for Bot API mode, or TELEGRAM_API_ID and\n" +
      "TELEGRAM_API_HASH for user-account mode — or name the mode:\n" +
      "  grokbot-telegram bot  |  grokbot-telegram user  |  grokbot-telegram login",
  );
}

async function main(argv, env) {
  const [command, ...rest] = argv;

  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === "--version" || command === "-v") {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  let mode = command;
  if (mode === undefined) {
    const detected = detectMode(env);
    if (detected instanceof Error) {
      process.stderr.write(`${detected.message}\n`);
      return 2;
    }
    mode = detected;
  } else if (!MODES.has(mode)) {
    process.stderr.write(`Unknown command: ${mode}\n\n${USAGE}`);
    return 2;
  }

  // Hand the subcommand's own arguments down as if it had been invoked
  // directly, so argv[2] is never the mode name.
  process.argv = [process.argv[0], process.argv[1], ...rest];

  await import(MODES.get(mode));
  return 0;
}

const code = await main(process.argv.slice(2), process.env);
if (code !== 0) process.exit(code);
