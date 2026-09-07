const BOT_TOKEN_LIKE = /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g;
const API_HASH_LIKE = /\b[a-f0-9]{32}\b/gi;
const SESSION_LIKE = /\b[A-Za-z0-9+/_-]{80,}\b/g;

export function redactSecrets(
  text: string,
  secrets: Array<string | undefined> = [],
): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      out = out.split(secret).join("[redacted]");
    }
  }
  out = out.replace(BOT_TOKEN_LIKE, "[redacted-bot-token]");
  out = out.replace(API_HASH_LIKE, "[redacted-api-hash]");
  out = out.replace(SESSION_LIKE, "[redacted-session]");
  return out;
}

export function currentSecrets(): string[] {
  return [
    process.env.TELEGRAM_API_HASH,
    process.env.TELEGRAM_SESSION,
    process.env.TELEGRAM_BOT_TOKEN,
  ].filter((value): value is string => Boolean(value && value.trim()));
}

export function safeErrorMessage(
  err: unknown,
  extraSecrets: Array<string | undefined> = [],
): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw, [...currentSecrets(), ...extraSecrets]);
}
