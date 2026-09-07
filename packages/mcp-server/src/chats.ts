export type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: { chat?: TelegramChat };
  edited_message?: { chat?: TelegramChat };
  channel_post?: { chat?: TelegramChat };
  edited_channel_post?: { chat?: TelegramChat };
  my_chat_member?: { chat?: TelegramChat };
  chat_member?: { chat?: TelegramChat };
  chat_join_request?: { chat?: TelegramChat };
  callback_query?: { message?: { chat?: TelegramChat } };
  business_message?: { chat?: TelegramChat };
};

export type ChatSummary = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

function summarize(chat: TelegramChat): ChatSummary {
  const summary: ChatSummary = { id: chat.id, type: chat.type };
  if (chat.title) summary.title = chat.title;
  if (chat.username) summary.username = chat.username;
  if (chat.first_name) summary.first_name = chat.first_name;
  if (chat.last_name) summary.last_name = chat.last_name;
  return summary;
}

function collectChats(update: TelegramUpdate): TelegramChat[] {
  const chats: TelegramChat[] = [];
  const push = (chat?: TelegramChat) => {
    if (chat && typeof chat.id === "number") chats.push(chat);
  };
  push(update.message?.chat);
  push(update.edited_message?.chat);
  push(update.channel_post?.chat);
  push(update.edited_channel_post?.chat);
  push(update.my_chat_member?.chat);
  push(update.chat_member?.chat);
  push(update.chat_join_request?.chat);
  push(update.callback_query?.message?.chat);
  push(update.business_message?.chat);
  return chats;
}

function mergeChat(existing: ChatSummary | undefined, next: ChatSummary): ChatSummary {
  if (!existing) return next;
  return {
    id: next.id,
    type: next.type || existing.type,
    title: next.title ?? existing.title,
    username: next.username ?? existing.username,
    first_name: next.first_name ?? existing.first_name,
    last_name: next.last_name ?? existing.last_name,
  };
}

/**
 * Unique chats seen in Bot API updates.
 * This is not a full dialog list — Bot API cannot enumerate every chat a bot is in.
 */
export function chatsFromUpdates(updates: TelegramUpdate[]): ChatSummary[] {
  const byId = new Map<number, ChatSummary>();
  for (const update of updates) {
    for (const chat of collectChats(update)) {
      byId.set(chat.id, mergeChat(byId.get(chat.id), summarize(chat)));
    }
  }
  return [...byId.values()];
}
