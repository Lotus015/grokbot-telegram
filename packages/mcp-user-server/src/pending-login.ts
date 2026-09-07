// A login is two tool calls: start_login sends a code, complete_login redeems
// it. Both the MTProto auth key and the phone_code_hash live in the client
// object, so a one-shot MCP host that starts a fresh process per call loses
// them between the two and the code can never be redeemed.
//
// So the in-flight state goes to disk. The file holds a pre-authorization
// session: it cannot read or send anything, but it is the auth key the code is
// bound to, so it is written 0600 and deleted the moment login succeeds.
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { defaultSessionPath } from "./credentials.js";

// Comfortably longer than a Telegram login code lives, short enough that an
// abandoned attempt does not leave an auth key lying around.
export const PENDING_TTL_MS = 15 * 60 * 1000;

export type PendingPhone = {
  phone: string;
  phoneCodeHash: string;
  isCodeViaApp: boolean;
};

export type PendingLogin = {
  kind: "phone" | "qr";
  session: string;
  startedAtMs: number;
  phone?: PendingPhone;
};

export function pendingLoginPath(
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const session =
    home === undefined ? defaultSessionPath(env) : defaultSessionPath(env, home);
  return `${session}.pending.json`;
}

function isPendingLogin(value: unknown): value is PendingLogin {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== "phone" && v.kind !== "qr") return false;
  if (typeof v.session !== "string" || v.session === "") return false;
  if (typeof v.startedAtMs !== "number" || !Number.isFinite(v.startedAtMs)) {
    return false;
  }
  if (v.phone !== undefined) {
    const p = v.phone as Record<string, unknown>;
    if (
      p === null ||
      typeof p !== "object" ||
      typeof p.phone !== "string" ||
      typeof p.phoneCodeHash !== "string" ||
      typeof p.isCodeViaApp !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

export function writePendingLogin(
  pending: PendingLogin,
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const path = pendingLoginPath(env, home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(pending), { encoding: "utf8", mode: 0o600 });
  return path;
}

// Returns null when there is nothing pending, when the file is too old, or
// when it is unreadable. A stale or corrupt file is removed rather than
// reported: it holds an auth key nobody is going to use.
export function readPendingLogin(
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): PendingLogin | null {
  const path = pendingLoginPath(env, home);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    clearPendingLogin(env, home);
    return null;
  }

  if (!isPendingLogin(parsed)) {
    clearPendingLogin(env, home);
    return null;
  }
  if (now - parsed.startedAtMs > PENDING_TTL_MS) {
    clearPendingLogin(env, home);
    return null;
  }
  return parsed;
}

export function clearPendingLogin(
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): void {
  rmSync(pendingLoginPath(env, home), { force: true });
}
