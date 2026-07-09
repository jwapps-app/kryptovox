// App-icon badge via the Badging API. Supported on iOS 16.4+ installed PWAs and
// desktop Chrome/Edge; a silent no-op everywhere else.
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function setAppBadge(count: number): void {
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) {
      nav.setAppBadge?.(count)?.catch(() => {});
    } else {
      nav.clearAppBadge?.()?.catch(() => {});
    }
  } catch {
    /* unsupported — ignore */
  }
}

// Android draws the app-icon dot from ACTIVE tray notifications, not the Badging
// API — so clearAppBadge() alone leaves the dot when messages are read in-app
// (over the socket, without tapping the banner). Dismiss the tray notifications
// for conversations that are no longer unread; once everything is read they all
// close and the dot clears. iOS ignores the tray for its count, so this is a
// no-op there beyond tidying the shade.
async function closeReadNotifications(
  unreadChatTags: Set<string>,
  hasGuestUnread: boolean
): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    if (!regs) return;
    for (const reg of regs) {
      for (const n of await reg.getNotifications()) {
        // Notification tags are the deep-link URL: /chat/{id} or /links/{thread}.
        // Secret-link unread isn't tracked per-thread, so keep all /links/*
        // while any guest reply is unread.
        const tag = n.tag || "";
        const keep = tag.startsWith("/links/")
          ? hasGuestUnread
          : unreadChatTags.has(tag);
        if (!keep) n.close();
      }
    }
  } catch {
    /* getNotifications/getRegistrations unsupported — ignore */
  }
}

// Reflect total unread (conversations + secret-link replies) on the app icon,
// and dismiss tray notifications for anything now read (clears the Android dot).
export function syncBadge(
  conversations: { id: string; unread_count: number }[],
  guestUnread = 0
): void {
  const total =
    conversations.reduce((n, c) => n + (c.unread_count || 0), 0) + guestUnread;
  setAppBadge(total);
  const unreadChatTags = new Set(
    conversations
      .filter((c) => (c.unread_count || 0) > 0)
      .map((c) => `/chat/${c.id}`)
  );
  void closeReadNotifications(unreadChatTags, guestUnread > 0);
}
