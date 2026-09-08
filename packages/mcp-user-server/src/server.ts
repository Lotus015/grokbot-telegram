import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { createGramJsUserClient, qrUrl } from "./client.js";
import {
  getUserApiCredentials,
  readSessionString,
  sessionSource,
  writeSessionString,
} from "./credentials.js";
import {
  clearPendingLogin,
  readPendingLogin,
  writePendingLogin,
  type PendingPhone,
} from "./pending-login.js";
import { filterDialogs } from "./dialogs.js";
import { applyDisclaimer, disclaimerText } from "./disclaimer.js";
import { safeErrorMessage } from "./redact.js";
import {
  isExpiredLoginToken,
  isPasswordNeeded,
  type TelegramUserClient,
} from "./types.js";

const VERSION = "0.3.1";

const SESSION_WARNING =
  "This session string is full access to the personal Telegram account. Save it in Plugins → Configure as TELEGRAM_SESSION (or keep the session file). Never commit it. Treat it like a password.";

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(err: unknown) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: safeErrorMessage(err) }],
  };
}

export type UserServerOptions = {
  createClient?: (session?: string) => TelegramUserClient;
};

export function createTelegramUserMcpServer(
  options: UserServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: "telegram-user",
    version: VERSION,
  });

  const createClient = options.createClient ?? createGramJsUserClient;
  let client: TelegramUserClient | undefined;
  let pendingPhone: PendingPhone | undefined;
  let qrUnsubscribe: (() => void) | undefined;
  let qrScanned: { promise: Promise<void>; resolve: () => void } | undefined;

  async function getClient(): Promise<TelegramUserClient> {
    getUserApiCredentials();
    if (!client) {
      // No real session yet, but a login may be in flight from an earlier
      // process. Its pre-auth session is the auth key the pending code is
      // bound to; without it the code cannot be redeemed.
      const resumed =
        readSessionString() === "" ? (readPendingLogin()?.session ?? undefined) : undefined;
      client = createClient(resumed);
    }
    await client.connect();
    return client;
  }

  // In-memory when the process survived both calls, from disk when it did not.
  function loadPendingPhone(): PendingPhone | undefined {
    if (pendingPhone) return pendingPhone;
    const stored = readPendingLogin();
    if (stored?.phone === undefined) return undefined;
    pendingPhone = stored.phone;
    return pendingPhone;
  }

  function rememberPendingLogin(
    active: TelegramUserClient,
    kind: "phone" | "qr",
    phone?: PendingPhone,
  ): void {
    try {
      writePendingLogin({
        kind,
        session: active.exportSession(),
        startedAtMs: Date.now(),
        ...(phone === undefined ? {} : { phone }),
      });
    } catch {
      // Losing the resume file only costs a restart of the login; it must
      // never fail the call the user is actually making.
    }
  }

  function persist(active: TelegramUserClient): {
    session: string;
    session_file: string;
  } {
    const session = active.exportSession();
    const session_file = writeSessionString(session);
    return { session, session_file };
  }

  // Telegram gives a QR token about half a minute. Callers need that as a
  // number, not a unix timestamp they have to reason about, because the whole
  // difficulty with QR in a chat is that the window closes while the code is
  // still being rendered into the conversation.
  function expiresInSeconds(expires: number): number {
    const remaining = Math.round(expires - Date.now() / 1000);
    return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
  }

  const QR_DELIVERY =
    "Send login_url to the user as the whole message, on its own, before any commentary — the code dies in seconds and anything ahead of it eats the window. Telegram → Settings → Devices → Link Desktop Device.";

  async function finishQr(active: TelegramUserClient, password?: string) {
    let token = await active.exportLoginToken();
    if (token.kind === "migrate") {
      await active.switchDc(token.dcId);
      try {
        token = await active.importLoginToken(token.token);
      } catch (err) {
        if (!isExpiredLoginToken(err)) throw err;
        // The token this login started with has lapsed. That is a dead QR,
        // not a broken client: ask the server for a fresh one to show.
        token = await active.exportLoginToken();
      }
    }
    if (token.kind === "success") {
      clearPendingLogin();
      const saved = persist(active);
      return {
        ok: true,
        me: token.user,
        ...saved,
        warning: SESSION_WARNING,
      };
    }
    if (password) {
      const me = await active.signInWithPassword(password);
      clearPendingLogin();
      const saved = persist(active);
      return { ok: true, me, ...saved, warning: SESSION_WARNING };
    }
    if (token.kind === "token") {
      // Exporting again produced a *different* code. Saying only "not
      // completed yet" would send the user back to a QR that can no longer
      // be completed, so hand over the new one.
      return {
        ok: false,
        waiting: true,
        login_url: qrUrl(token.token),
        expires: token.expires,
        expires_in_seconds: expiresInSeconds(token.expires),
        note: `Not linked yet, and this is a NEW QR code — any code shown earlier can no longer be completed. ${QR_DELIVERY} Then call complete_qr_login again; each attempt hands back a fresh code, so repeat as needed. If 2FA is enabled, pass password. If the window keeps closing before the user can scan, switch to start_login — a phone code lives minutes, not seconds.`,
      };
    }
    return {
      ok: false,
      waiting: true,
      note: "QR not completed yet. Scan in Telegram (Settings → Devices → Link Desktop Device), then call complete_qr_login again. If 2FA is enabled, pass password.",
    };
  }

  server.registerTool(
    "auth_status",
    {
      title: "User-account auth status",
      description:
        "[User account] Check whether TELEGRAM_API_ID / TELEGRAM_API_HASH / session are configured and whether the MTProto session is authorized. Does not use TELEGRAM_BOT_TOKEN.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        try {
          getUserApiCredentials();
        } catch (err) {
          return jsonResult({
            configured: false,
            authorized: false,
            session_source: sessionSource(),
            error: safeErrorMessage(err),
          });
        }
        const active = await getClient();
        const authorized = await active.isAuthorized();
        return jsonResult({
          configured: true,
          authorized,
          session_source: sessionSource(),
          me: authorized ? await active.getMe() : undefined,
          pending_phone_login: Boolean(pendingPhone),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "start_login",
    {
      title: "Start phone login",
      description:
        "[User account] Send a Telegram login code to the user's phone. Then call complete_login with the code (and 2FA password if needed).",
      inputSchema: z.object({
        phone: z
          .string()
          .min(6)
          .describe("Phone number in international format, e.g. +15551234567."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ phone }) => {
      try {
        const active = await getClient();
        if (await active.isAuthorized()) {
          return jsonResult({
            already_authorized: true,
            me: await active.getMe(),
          });
        }
        const result = await active.sendCode(phone.trim());
        pendingPhone = {
          phone: phone.trim(),
          phoneCodeHash: result.phoneCodeHash,
          isCodeViaApp: result.isCodeViaApp,
        };
        rememberPendingLogin(active, "phone", pendingPhone);
        return jsonResult({
          ok: true,
          phone: pendingPhone.phone,
          is_code_via_app: result.isCodeViaApp,
          next: "Ask the user for the login code, then call complete_login. Do not echo api_hash or session.",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "complete_login",
    {
      title: "Complete phone login",
      description:
        "[User account] Submit the login code (and optional 2FA cloud password) after start_login. Returns a session string — full account access; save as TELEGRAM_SESSION.",
      inputSchema: z.object({
        code: z.string().min(1).describe("Login code from Telegram or SMS."),
        password: z
          .string()
          .optional()
          .describe("2FA cloud password if the account has two-step verification."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ code, password }) => {
      try {
        const pending = loadPendingPhone();
        if (!pending) {
          return errorResult(
            new Error(
              "No pending phone login. Call start_login with the phone number first. If you did, the login code has expired — start over.",
            ),
          );
        }
        const active = await getClient();
        let me;
        try {
          me = await active.signIn(
            pending.phone,
            pending.phoneCodeHash,
            code.trim(),
          );
        } catch (err) {
          if (isPasswordNeeded(err)) {
            if (!password) {
              return errorResult(
                new Error(
                  "SESSION_PASSWORD_NEEDED. This account has two-step verification. Call complete_login again with password.",
                ),
              );
            }
            me = await active.signInWithPassword(password);
          } else {
            throw err;
          }
        }
        pendingPhone = undefined;
        clearPendingLogin();
        const saved = persist(active);
        return jsonResult({
          ok: true,
          me,
          ...saved,
          warning: SESSION_WARNING,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "start_qr_login",
    {
      title: "Start QR login",
      description:
        "[User account] Begin QR / Link Desktop Device login. Show login_url to the user, then call complete_qr_login after they scan.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const active = await getClient();
        if (await active.isAuthorized()) {
          return jsonResult({
            already_authorized: true,
            me: await active.getMe(),
          });
        }
        qrUnsubscribe?.();
        let resolve = () => {};
        const promise = new Promise<void>((res) => {
          resolve = res;
        });
        qrScanned = { promise, resolve };
        qrUnsubscribe = active.onLoginToken(() => qrScanned?.resolve());
        const token = await active.exportLoginToken();
        if (token.kind === "success") {
          const saved = persist(active);
          return jsonResult({
            ok: true,
            already_authorized: true,
            me: token.user,
            ...saved,
            warning: SESSION_WARNING,
          });
        }
        if (token.kind !== "token") {
          return errorResult(new Error("Could not export a QR login token."));
        }
        rememberPendingLogin(active, "qr");
        return jsonResult({
          ok: true,
          login_url: qrUrl(token.token),
          expires: token.expires,
          expires_in_seconds: expiresInSeconds(token.expires),
          how: `${QR_DELIVERY} Then call complete_qr_login. If it reports waiting, it returns a fresh code — show that one. If the user cannot scan in time, start_login is the better path: a phone code lives minutes.`,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "complete_qr_login",
    {
      title: "Complete QR login",
      description:
        "[User account] Finish QR login after the user scans. Pass password if 2FA is enabled. Returns a session string — full account access.",
      inputSchema: z.object({
        password: z
          .string()
          .optional()
          .describe("2FA cloud password if two-step verification is enabled."),
        wait_ms: z
          .number()
          .int()
          .min(0)
          .max(120000)
          .optional()
          .describe("Optional time to wait for the scan event (default 15000)."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ password, wait_ms }) => {
      try {
        const active = await getClient();
        // The scan can land while this process does not exist: the phone
        // authorizes the auth key server-side, and the resumed session is
        // that key. There is no token left to redeem, and none is needed.
        if (await active.isAuthorized()) {
          clearPendingLogin();
          const saved = persist(active);
          return jsonResult({
            ok: true,
            me: await active.getMe(),
            ...saved,
            warning: SESSION_WARNING,
          });
        }
        if (qrScanned) {
          const wait = wait_ms ?? 15_000;
          await Promise.race([
            qrScanned.promise,
            new Promise((resolve) => setTimeout(resolve, wait)),
          ]);
        }
        try {
          return jsonResult(await finishQr(active, password));
        } catch (err) {
          if (isPasswordNeeded(err)) {
            if (!password) {
              return errorResult(
                new Error(
                  "SESSION_PASSWORD_NEEDED. Call complete_qr_login again with password.",
                ),
              );
            }
            const me = await active.signInWithPassword(password);
            clearPendingLogin();
            const saved = persist(active);
            return jsonResult({
              ok: true,
              me,
              ...saved,
              warning: SESSION_WARNING,
            });
          }
          throw err;
        }
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_me",
    {
      title: "Get logged-in user",
      description:
        "[User account] Return the authorized personal Telegram user (not a bot). Use to verify the MTProto session.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const active = await getClient();
        if (!(await active.isAuthorized())) {
          return errorResult(
            new Error(
              "Not logged in. Set TELEGRAM_SESSION or run start_login / start_qr_login. See the telegram-user-setup skill.",
            ),
          );
        }
        return jsonResult(await active.getMe());
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_dialogs",
    {
      title: "List dialogs",
      description:
        "[User account] List chats from the real Telegram dialog list (inbox), not Bot API getUpdates.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max dialogs to return (1–200). Default 50."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit }) => {
      try {
        const active = await getClient();
        const dialogs = await active.listDialogs(limit ?? 50);
        return jsonResult({ dialogs, count: dialogs.length });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "search_dialogs",
    {
      title: "Search dialogs",
      description:
        "[User account] Search the dialog list by title, username, or id. Resolve chats here before send_message.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Case-insensitive substring to match."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max dialogs to scan (1–200). Default 100."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      try {
        const active = await getClient();
        const dialogs = filterDialogs(
          await active.listDialogs(limit ?? 100),
          query,
        );
        return jsonResult({ query, dialogs, count: dialogs.length });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_messages",
    {
      title: "Get recent messages",
      description:
        "[User account] Fetch recent history for a chat (id, @username, or me).",
      inputSchema: z.object({
        chat: z
          .string()
          .min(1)
          .describe("Chat id, @username, or me (Saved Messages)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max messages (1–100). Default 20."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chat, limit }) => {
      try {
        const active = await getClient();
        const messages = await active.getMessages(chat, limit ?? 20);
        return jsonResult({ chat, messages, count: messages.length });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "send_message",
    {
      title: "Send as the logged-in user",
      description:
        "[User account] Send a text message as the personal Telegram account (not a bot). Confirm destination and text with the user first. A disclaimer footer is appended to every message unless TELEGRAM_DISCLAIMER is off, and it counts against Telegram's 4096-character limit.",
      inputSchema: z.object({
        chat: z
          .string()
          .min(1)
          .describe("Destination: me, @username, or a dialog id from list_dialogs."),
        text: z.string().min(1).max(4096).describe("Message text to send."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ chat, text }) => {
      try {
        const active = await getClient();
        if (!(await active.isAuthorized())) {
          return errorResult(
            new Error("Not logged in. Complete user-account login before sending."),
          );
        }
        const sentText = applyDisclaimer(text);
        const result = await active.sendMessage(chat, sentText);
        return jsonResult({
          ...result,
          identity: "user-account",
          disclaimer: disclaimerText(),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
