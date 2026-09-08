import type { DialogSummary } from "./dialogs.js";

// GramJS resolves a plain string by asking Telegram to look up a username. A
// group *title* is not a username, so passing one through makes the call cast
// about and, in a one-shot process, hang until the host gives up — a minute of
// nothing instead of an immediate, fixable error. Anything that is not already
// an id or a username is therefore resolved here, against the dialog list.

export type Destination =
  | { kind: "direct"; target: string }
  // A bare word is ambiguous: it could be a username, or the name of a chat
  // the user already has. Look at their own dialogs first — sending to a
  // stranger who happens to hold that username is the worse mistake — and
  // fall back to treating it as a username only when nothing matches.
  | { kind: "lookup"; title: string; usernameFallback: boolean };

const SAVED_MESSAGES = new Set(["me", "self", "saved"]);
const NUMERIC_ID = /^-?\d+$/;
// Telegram usernames: 5-32 chars, letters, digits and underscores.
const USERNAME = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/;

export function classifyDestination(chat: string): Destination {
  const trimmed = chat.trim();
  if (SAVED_MESSAGES.has(trimmed.toLowerCase())) {
    return { kind: "direct", target: "me" };
  }
  if (NUMERIC_ID.test(trimmed)) return { kind: "direct", target: trimmed };
  // An explicit @ says the user means the username namespace, so take them at
  // their word and skip the lookup.
  if (trimmed.startsWith("@") && USERNAME.test(trimmed)) {
    return { kind: "direct", target: trimmed };
  }
  return {
    kind: "lookup",
    title: trimmed,
    usernameFallback: USERNAME.test(trimmed),
  };
}

export class DestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DestinationError";
  }
}

// An exact title match wins outright; otherwise a substring match counts only
// when it is unambiguous. Guessing between candidates would send someone's
// message to the wrong chat.
export function resolveTitle(
  dialogs: DialogSummary[],
  title: string,
): DialogSummary | null {
  const wanted = title.toLowerCase();
  const exact = dialogs.filter((d) => d.title.trim().toLowerCase() === wanted);
  const candidates =
    exact.length > 0
      ? exact
      : dialogs.filter((d) => d.title.toLowerCase().includes(wanted));

  if (candidates.length === 1) return candidates[0] as DialogSummary;

  // Not found is for the caller to interpret: it may still be a username.
  if (candidates.length === 0) return null;

  const shown = candidates
    .slice(0, 5)
    .map((d) => `${d.title} (${d.type}, id ${d.id})`)
    .join("; ");
  throw new DestinationError(
    `${candidates.length} chats match ${JSON.stringify(title)}: ${shown}. Ask the user which one, then send to that id.`,
  );
}

export function noSuchChatError(title: string): DestinationError {
  return new DestinationError(
    `No chat named ${JSON.stringify(title)} in the dialog list. Call list_dialogs or search_dialogs, confirm the chat with the user, and send to its id.`,
  );
}
