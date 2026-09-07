// Every outgoing message carries a footer saying it was sent by the agent.
// Set TELEGRAM_DISCLAIMER to change the wording, or to "off" to drop it.
//
// The wording names the package rather than linking to it. A URL here would
// make Telegram attach a link-preview card to every message the user sends,
// and reads as advertising in a personal chat; the name is still searchable.

export const DEFAULT_DISCLAIMER = "— sent by grokbot-telegram";
export const TELEGRAM_TEXT_LIMIT = 4096;

const OFF_VALUES = new Set(["", "off", "false", "0", "no", "none", "disabled"]);

export type ParseMode = "HTML" | "Markdown" | "MarkdownV2" | undefined;

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

// The footer is plain prose, so it has to be escaped for whatever parse mode
// the caller picked. MarkdownV2 in particular rejects a bare "." or "-", which
// would make Telegram refuse the whole message.
export function escapeForParseMode(text: string, parseMode: ParseMode): string {
  switch (parseMode) {
    case "HTML":
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    case "Markdown":
      return text.replace(/[_*`[\]]/g, (ch) => `\\${ch}`);
    case "MarkdownV2":
      return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (ch) => `\\${ch}`);
    default:
      return text;
  }
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
  parseMode: ParseMode = undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const disclaimer = disclaimerText(env);
  if (disclaimer === null) return text;

  const suffix = `\n\n${escapeForParseMode(disclaimer, parseMode)}`;
  const combined = `${text}${suffix}`;
  if (combined.length > TELEGRAM_TEXT_LIMIT) {
    throw new DisclaimerOverflowError(combined.length - TELEGRAM_TEXT_LIMIT);
  }
  return combined;
}
