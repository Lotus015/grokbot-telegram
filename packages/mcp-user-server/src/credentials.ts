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

// Telegram issues api_id/api_hash per developer and refuses credentials that
// have been published (API_ID_PUBLISHED_FLOOD), so this package cannot ship a
// shared pair. The user gets their own once, and we keep it for them rather
// than making them paste it into a config file every time.
export function apiCredentialsPath(
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const session =
    home === undefined ? defaultSessionPath(env) : defaultSessionPath(env, home);
  return join(dirname(session), "api-credentials.json");
}

export type StoredApiCredentials = { apiId: number; apiHash: string };

export function readStoredApiCredentials(
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): StoredApiCredentials | null {
  const path = apiCredentialsPath(env, home);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const v = parsed as Record<string, unknown>;
    const apiId = Number(v.apiId);
    const apiHash = typeof v.apiHash === "string" ? v.apiHash.trim() : "";
    if (!Number.isInteger(apiId) || apiId <= 0 || apiHash === "") return null;
    return { apiId, apiHash };
  } catch {
    return null;
  }
}

export function writeApiCredentials(
  credentials: StoredApiCredentials,
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const path = apiCredentialsPath(env, home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(credentials), {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}

export function apiCredentialsSource(
  env: NodeJS.ProcessEnv = process.env,
): "env" | "file" | "none" {
  const id = env.TELEGRAM_API_ID?.trim() ?? "";
  const hash = env.TELEGRAM_API_HASH?.trim() ?? "";
  if (id && hash && !isPlaceholder(id) && !isPlaceholder(hash)) return "env";
  return readStoredApiCredentials(env) === null ? "none" : "file";
}

export function getUserApiCredentials(): { apiId: number; apiHash: string } {
  const stored = readStoredApiCredentials();
  const apiIdRaw = process.env.TELEGRAM_API_ID?.trim() || (stored ? String(stored.apiId) : "");
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || stored?.apiHash || "";

  if (!apiIdRaw || isPlaceholder(apiIdRaw)) {
    throw new UserAuthError(
      "TELEGRAM_API_ID is missing. Open https://my.telegram.org/apps, sign in with the phone number of the account, fill any app title and short name, and copy api_id. Then call save_api_credentials with it — no config file needed. Telegram issues these per developer and rejects shared ones, so there is no way around this step. User-account mode does not use TELEGRAM_BOT_TOKEN.",
    );
  }
  if (!apiHash || isPlaceholder(apiHash)) {
    throw new UserAuthError(
      "TELEGRAM_API_HASH is missing. It is on the same https://my.telegram.org/apps page as api_id. Pass it to save_api_credentials, which stores it 0600. Never echo it back to the user or into chat.",
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
