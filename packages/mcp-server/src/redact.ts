const TOKEN_LIKE = /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g;
const BOT_PATH = /\/bot[^/\s]+/g;

export function redactSecrets(text: string, token?: string): string {
  let out = text;
  if (token && token.length > 0) {
    out = out.split(token).join("[redacted-bot-token]");
  }
  out = out.replace(TOKEN_LIKE, "[redacted-bot-token]");
  out = out.replace(BOT_PATH, "/bot[redacted-bot-token]");
  return out;
}

export function safeErrorMessage(err: unknown, token?: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw, token);
}
