import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import {
  getUserApiCredentials,
  readSessionString,
} from "./credentials.js";
import type { DialogSummary } from "./dialogs.js";
import {
  isPasswordNeeded,
  resolveChatTarget,
  type HistoryMessage,
  type LoginTokenResult,
  type SentMessage,
  type TelegramUserClient,
  type UserInfo,
} from "./types.js";

const VERSION = "0.3.1";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function mapUser(user: unknown): UserInfo {
  const u = asRecord(user) ?? {};
  const username = typeof u.username === "string" ? u.username : undefined;
  const firstName = typeof u.firstName === "string" ? u.firstName : undefined;
  const lastName = typeof u.lastName === "string" ? u.lastName : undefined;
  const phone = typeof u.phone === "string" ? u.phone : undefined;
  return {
    id: String(u.id ?? ""),
    username,
    firstName,
    lastName,
    phone,
    isBot: Boolean(u.bot),
  };
}

function mapDialog(dialog: {
  id?: unknown;
  title?: string;
  unreadCount?: number;
  isUser?: boolean;
  isGroup?: boolean;
  isChannel?: boolean;
  entity?: { username?: string };
}): DialogSummary {
  let type: DialogSummary["type"] = "unknown";
  if (dialog.isUser) type = "user";
  else if (dialog.isGroup) type = "group";
  else if (dialog.isChannel) type = "channel";
  const username = dialog.entity?.username;
  return {
    id: String(dialog.id ?? ""),
    title: dialog.title ?? "",
    type,
    username,
    unreadCount: dialog.unreadCount,
  };
}

function mapMessage(msg: {
  id?: number;
  date?: number;
  text?: string;
  message?: string;
  out?: boolean;
  senderId?: unknown;
  chatId?: unknown;
}): HistoryMessage {
  return {
    id: Number(msg.id ?? 0),
    date: msg.date ? new Date(msg.date * 1000).toISOString() : undefined,
    text: msg.text || msg.message || "",
    out: msg.out,
    senderId: msg.senderId != null ? String(msg.senderId) : undefined,
  };
}

function loginTokenFromResult(result: unknown): LoginTokenResult {
  if (result instanceof Api.auth.LoginTokenSuccess) {
    const auth = result.authorization;
    if (auth instanceof Api.auth.Authorization) {
      return { kind: "success", user: mapUser(auth.user) };
    }
    throw new Error("Unexpected QR authorization payload");
  }
  if (result instanceof Api.auth.LoginTokenMigrateTo) {
    return { kind: "migrate", dcId: result.dcId, token: Buffer.from(result.token) };
  }
  if (result instanceof Api.auth.LoginToken) {
    return {
      kind: "token",
      token: Buffer.from(result.token),
      expires: Number(result.expires),
    };
  }
  throw new Error("Unexpected ExportLoginToken result");
}

function qrUrl(token: Buffer): string {
  return `tg://login?token=${token.toString("base64url")}`;
}

export { qrUrl };

// `resumeSession` carries the pre-authorization session of a login started in
// an earlier process. Without it a restarted process builds a fresh auth key
// and Telegram answers PHONE_CODE_EXPIRED, because the pending code is bound
// to the key that requested it.
export function createGramJsUserClient(
  resumeSession?: string,
): TelegramUserClient {
  const { apiId, apiHash } = getUserApiCredentials();
  const session = new StringSession(resumeSession ?? readSessionString());
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    // This is what the account owner sees in Telegram → Settings → Devices,
    // so it names the package they would search for to find or revoke it.
    deviceModel: "grokbot-telegram",
    appVersion: VERSION,
    systemVersion: `${process.platform} ${process.arch}`,
    langCode: "en",
  });

  const adapter: TelegramUserClient = {
    async connect() {
      if (!client.connected) await client.connect();
    },
    async disconnect() {
      if (client.connected) await client.disconnect();
    },
    async isAuthorized() {
      await adapter.connect();
      return client.checkAuthorization();
    },
    async getMe() {
      await adapter.connect();
      return mapUser(await client.getMe());
    },
    async listDialogs(limit: number) {
      await adapter.connect();
      const dialogs = await client.getDialogs({ limit });
      return dialogs.map((dialog) =>
        mapDialog(dialog as unknown as Parameters<typeof mapDialog>[0]),
      );
    },
    async getMessages(chat: string, limit: number) {
      await adapter.connect();
      const messages = await client.getMessages(resolveChatTarget(chat), {
        limit,
      });
      return messages.map((msg) => mapMessage(msg));
    },
    async sendMessage(chat: string, text: string) {
      await adapter.connect();
      const target = resolveChatTarget(chat);
      const sent = await client.sendMessage(target, { message: text });
      return {
        id: Number(sent.id ?? 0),
        chatId: sent.chatId != null ? String(sent.chatId) : target,
        text: sent.text || sent.message || text,
        date: sent.date ? new Date(sent.date * 1000).toISOString() : undefined,
      };
    },
    async sendCode(phone: string) {
      await adapter.connect();
      return client.sendCode({ apiId, apiHash }, phone);
    },
    async signIn(phone: string, phoneCodeHash: string, phoneCode: string) {
      await adapter.connect();
      try {
        const result = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash,
            phoneCode,
          }),
        );
        if (result instanceof Api.auth.AuthorizationSignUpRequired) {
          throw new Error(
            "This phone number is not registered on Telegram. Sign up in the official app first.",
          );
        }
        if (result instanceof Api.auth.Authorization) {
          return mapUser(result.user);
        }
        throw new Error("Unexpected SignIn result");
      } catch (err) {
        if (isPasswordNeeded(err)) {
          const needed = new Error("SESSION_PASSWORD_NEEDED");
          (needed as { errorMessage?: string }).errorMessage =
            "SESSION_PASSWORD_NEEDED";
          throw needed;
        }
        throw err;
      }
    },
    async signInWithPassword(password: string) {
      await adapter.connect();
      const user = await client.signInWithPassword(
        { apiId, apiHash },
        {
          password: async () => password,
          onError: (err) => {
            throw err;
          },
        },
      );
      return mapUser(user);
    },
    async exportLoginToken() {
      await adapter.connect();
      const result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId,
          apiHash,
          exceptIds: [],
        }),
      );
      return loginTokenFromResult(result);
    },
    async importLoginToken(token: Buffer) {
      await adapter.connect();
      const result = await client.invoke(
        new Api.auth.ImportLoginToken({ token }),
      );
      return loginTokenFromResult(result);
    },
    async switchDc(dcId: number) {
      await (client as unknown as { _switchDC: (id: number) => Promise<void> })._switchDC(
        dcId,
      );
    },
    onLoginToken(handler: () => void) {
      const wrapped = (update: unknown) => {
        if (update instanceof Api.UpdateLoginToken) handler();
      };
      client.addEventHandler(wrapped);
      return () => {
        // teleproto requires an EventBuilder to remove a handler; login is one-shot.
      };
    },
    exportSession() {
      return String(client.session.save());
    },
  };

  return adapter;
}
