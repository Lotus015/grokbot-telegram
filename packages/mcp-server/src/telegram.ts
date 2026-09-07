import { redactSecrets, safeErrorMessage } from "./redact.js";

const API_ROOT = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly errorCode?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export function getBotToken(): string {
  const raw = process.env.TELEGRAM_BOT_TOKEN;
  if (raw == null || raw.trim() === "") {
    throw new TelegramApiError(
      "TELEGRAM_BOT_TOKEN is missing. Set it in Cursor under Plugins → Configure. Never paste the token into chat.",
    );
  }
  const token = raw.trim();
  if (
    token.includes("${") ||
    token === "your-bot-token" ||
    token === "YOUR_TOKEN"
  ) {
    throw new TelegramApiError(
      "TELEGRAM_BOT_TOKEN is still a placeholder. Set the real token in Plugins → Configure.",
    );
  }
  return token;
}

type TelegramOk<T> = { ok: true; result: T };
type TelegramFail = { ok: false; description?: string; error_code?: number };

export type SendMessageParams = {
  chat_id: string | number;
  text: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
};

export type GetUpdatesParams = {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowed_updates?: string[];
};

export async function telegramMethod<T>(
  method: string,
  body?: Record<string, unknown>,
  token: string = getBotToken(),
): Promise<T> {
  const url = `${API_ROOT}/bot${token}/${method}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    throw new TelegramApiError(
      `Telegram Bot API network error: ${safeErrorMessage(err, token)}`,
    );
  }

  let payload: TelegramOk<T> | TelegramFail;
  try {
    payload = (await response.json()) as TelegramOk<T> | TelegramFail;
  } catch (err) {
    throw new TelegramApiError(
      `Telegram Bot API returned a non-JSON response (HTTP ${response.status}): ${safeErrorMessage(err, token)}`,
    );
  }

  if (!payload.ok) {
    const description = redactSecrets(
      payload.description ?? `HTTP ${response.status}`,
      token,
    );
    throw new TelegramApiError(
      `Telegram Bot API error: ${description}`,
      payload.error_code,
    );
  }

  return payload.result;
}

export function getMe() {
  return telegramMethod<Record<string, unknown>>("getMe");
}

export function sendMessage(params: SendMessageParams) {
  const payload: Record<string, unknown> = {
    chat_id: params.chat_id,
    text: params.text,
  };
  if (params.parse_mode) payload.parse_mode = params.parse_mode;
  return telegramMethod<Record<string, unknown>>("sendMessage", payload);
}

export function getUpdates(params: GetUpdatesParams = {}) {
  const payload: Record<string, unknown> = {};
  if (params.offset !== undefined) payload.offset = params.offset;
  if (params.limit !== undefined) payload.limit = params.limit;
  if (params.timeout !== undefined) payload.timeout = params.timeout;
  if (params.allowed_updates !== undefined) {
    payload.allowed_updates = params.allowed_updates;
  }
  return telegramMethod<unknown[]>("getUpdates", payload);
}
