import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export class UserAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserAuthError";
  }
}

function isPlaceholder(value: string): boolean {
  return (
    value.includes("${") ||
    value === "YOUR_API_ID" ||
    value === "YOUR_API_HASH" ||
    value === "YOUR_SESSION" ||
    value === "your-api-id" ||
    value === "your-api-hash"
  );
}

export function defaultSessionPath(): string {
  const fromEnv = process.env.TELEGRAM_SESSION_PATH?.trim();
  if (fromEnv && !fromEnv.includes("${")) return fromEnv;
  return join(homedir(), ".cursor-telegram-plugin", "user.session");
}

export function getUserApiCredentials(): { apiId: number; apiHash: string } {
  const apiIdRaw = process.env.TELEGRAM_API_ID?.trim() ?? "";
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() ?? "";

  if (!apiIdRaw || isPlaceholder(apiIdRaw)) {
    throw new UserAuthError(
      "TELEGRAM_API_ID is missing. Get api_id from https://my.telegram.org/apps and set it in Cursor under Plugins → Configure. User-account mode does not use TELEGRAM_BOT_TOKEN.",
    );
  }
  if (!apiHash || isPlaceholder(apiHash)) {
    throw new UserAuthError(
      "TELEGRAM_API_HASH is missing. Get api_hash from https://my.telegram.org/apps and set it in Cursor under Plugins → Configure. Never paste it into chat.",
    );
  }

  const apiId = Number(apiIdRaw);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new UserAuthError("TELEGRAM_API_ID must be a positive integer.");
  }
  return { apiId, apiHash };
}

export function readSessionString(): string {
  const fromEnv = process.env.TELEGRAM_SESSION?.trim() ?? "";
  if (fromEnv && !isPlaceholder(fromEnv)) return fromEnv;
  const path = defaultSessionPath();
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

export function writeSessionString(session: string): string {
  const path = defaultSessionPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, session, { encoding: "utf8", mode: 0o600 });
  return path;
}

export function sessionSource(): "env" | "file" | "none" {
  const fromEnv = process.env.TELEGRAM_SESSION?.trim() ?? "";
  if (fromEnv && !isPlaceholder(fromEnv)) return "env";
  if (existsSync(defaultSessionPath())) return "file";
  return "none";
}
