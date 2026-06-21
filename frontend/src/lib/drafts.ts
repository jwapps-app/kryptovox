// Per-conversation unsent drafts, kept on this device so switching chats (or
// reloading) doesn't lose what you were typing.
const KEY = "kv_drafts";

function all(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function getDraft(conversationId: string): string {
  return all()[conversationId] ?? "";
}

export function setDraft(conversationId: string, text: string): void {
  const drafts = all();
  if (text) drafts[conversationId] = text;
  else delete drafts[conversationId];
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    /* storage full / blocked — ignore */
  }
}
