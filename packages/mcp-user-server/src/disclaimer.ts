// Messages sent through this server go out as the human account owner, so
// every one of them carries a footer saying an agent actually sent it.
// Set TELEGRAM_DISCLAIMER to change the wording, or to "off" to drop it.
//
// The wording names the package rather than linking to it. A URL here would
// make Telegram attach a link-preview card to every message the user sends,
// and reads as advertising in a personal chat; the name is still searchable.

export const DEFAULT_DISCLAIMER = "— sent by grokbot-telegram on my behalf";
export const TELEGRAM_TEXT_LIMIT = 4096;

const OFF_VALUES = new Set(["", "off", "false", "0", "no", "none", "disabled"]);

export function disclaimerText(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.TELEGRAM_DISCLAIMER;
  if (raw === undefined) return DEFAULT_DISCLAIMER;
  const trimmed = raw.trim();
  // An unset Cursor plugin variable arrives as the literal "${TELEGRAM_DISCLAIMER}".
  // Treat that as "not configured" rather than sending it as the footer.
  if (trimmed.includes("${")) return DEFAULT_DISCLAIMER;
  if (OFF_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

export class DisclaimerOverflowError extends Error {
  constructor(readonly overflow: number) {
    super(
      `Message plus the required disclaimer is ${overflow} characters over Telegram's ${TELEGRAM_TEXT_LIMIT}-character limit. Shorten the text, or split it across messages.`,
    );
    this.name = "DisclaimerOverflowError";
  }
}

// Returns the text to actually send. Throws rather than silently truncating:
// dropping the footer would defeat the point, and trimming the caller's words
// would send something they never wrote.
export function applyDisclaimer(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const disclaimer = disclaimerText(env);
  if (disclaimer === null) return text;

  const combined = `${text}\n\n${disclaimer}`;
  if (combined.length > TELEGRAM_TEXT_LIMIT) {
    throw new DisclaimerOverflowError(combined.length - TELEGRAM_TEXT_LIMIT);
  }
  return combined;
}
