import type { DialogSummary } from "./dialogs.js";

export type UserInfo = {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isBot: boolean;
};

export type HistoryMessage = {
  id: number;
  date?: string;
  text: string;
  out?: boolean;
  senderId?: string;
};

export type SentMessage = {
  id: number;
  chatId: string;
  text: string;
  date?: string;
};

export type SendCodeResult = {
  phoneCodeHash: string;
  isCodeViaApp: boolean;
};

export type LoginTokenResult =
  | { kind: "token"; token: Buffer; expires: number }
  | { kind: "success"; user: UserInfo }
  | { kind: "migrate"; dcId: number; token: Buffer };

export type TelegramUserClient = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isAuthorized(): Promise<boolean>;
  getMe(): Promise<UserInfo>;
  listDialogs(limit: number): Promise<DialogSummary[]>;
  getMessages(chat: string, limit: number): Promise<HistoryMessage[]>;
  sendMessage(chat: string, text: string): Promise<SentMessage>;
  sendCode(phone: string): Promise<SendCodeResult>;
  signIn(phone: string, phoneCodeHash: string, phoneCode: string): Promise<UserInfo>;
  signInWithPassword(password: string): Promise<UserInfo>;
  exportLoginToken(): Promise<LoginTokenResult>;
  importLoginToken(token: Buffer): Promise<LoginTokenResult>;
  switchDc(dcId: number): Promise<void>;
  onLoginToken(handler: () => void): () => void;
  exportSession(): string;
};

export function isPasswordNeeded(err: unknown): boolean {
  const e = err as { errorMessage?: string; message?: string };
  return (
    e.errorMessage === "SESSION_PASSWORD_NEEDED" ||
    e.message === "SESSION_PASSWORD_NEEDED"
  );
}

// A QR login token lives about half a minute. Redeeming one that has lapsed
// is an ordinary outcome of resuming a login, not a protocol failure.
export function isExpiredLoginToken(err: unknown): boolean {
  const e = err as { errorMessage?: string; message?: string };
  const text = `${e.errorMessage ?? ""} ${e.message ?? ""}`;
  return (
    text.includes("AUTH_TOKEN_EXPIRED") ||
    /authorization token has expired/i.test(text)
  );
}

export function resolveChatTarget(chat: string): string {
  const trimmed = chat.trim();
  if (trimmed === "self" || trimmed === "saved") return "me";
  return trimmed;
}
