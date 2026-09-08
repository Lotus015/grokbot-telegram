export type DialogSummary = {
  id: string;
  title: string;
  type: "user" | "group" | "channel" | "unknown";
  username?: string;
  unreadCount?: number;
  // True for a group with topics turned on. Its messages live in threads, so
  // list_forum_topics is the way in.
  isForum?: boolean;
};

export type ForumTopicSummary = {
  // Also the id of the message that opens the topic, which is what sending
  // into it replies to.
  id: number;
  title: string;
  unreadCount?: number;
  closed?: boolean;
  pinned?: boolean;
};

export function filterDialogs(
  dialogs: DialogSummary[],
  query: string,
): DialogSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return dialogs;
  return dialogs.filter((dialog) => {
    const hay = [
      dialog.title,
      dialog.username,
      dialog.id,
      dialog.type,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}
