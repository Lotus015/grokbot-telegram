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

// The project was called cursor-telegram-plugin before it became
// grokbot-telegram. New sessions land in the new directory, but an existing
// session in the old one is still read, so nobody has to log in again.
const LEGACY_SESSION_DIR = ".cursor-telegram-plugin";
const SESSION_DIR = ".grokbot-telegram";

// The home directory is a parameter so the fallback can be tested without
// touching the real one.
export function defaultSessionPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const fromEnv = env.TELEGRAM_SESSION_PATH?.trim();
  if (fromEnv && !fromEnv.includes("${")) return fromEnv;
  return join(home, SESSION_DIR, "user.session");
}

export function legacySessionPath(home: string = homedir()): string {
  return join(home, LEGACY_SESSION_DIR, "user.session");
}

// Where a session can actually be read from: the configured path first, then
// the pre-rename location. An explicit TELEGRAM_SESSION_PATH is taken at its
// word — no silent fallback to a directory the caller did not name.
export function existingSessionPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string | null {
  const configured = env.TELEGRAM_SESSION_PATH?.trim();
  const path = defaultSessionPath(env, home);
  if (existsSync(path)) return path;
  if (configured && !configured.includes("${")) return null;
  const legacy = legacySessionPath(home);
  return existsSync(legacy) ? legacy : null;
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
  const path = existingSessionPath();
  if (path === null) return "";
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
  if (existingSessionPath() !== null) return "file";
  return "none";
}
