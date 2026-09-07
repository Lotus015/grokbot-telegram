export type DialogSummary = {
  id: string;
  title: string;
  type: "user" | "group" | "channel" | "unknown";
  username?: string;
  unreadCount?: number;
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
