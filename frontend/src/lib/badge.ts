// App-icon badge via the Badging API. Supported on iOS 16.4+ installed PWAs and
// desktop Chrome/Edge; a silent no-op everywhere else.
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function setAppBadge(count: number): void {
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

// Reflect total unread (conversations + secret-link replies) on the app icon.
export function syncBadge(
  conversations: { unread_count: number }[],
  guestUnread = 0
): void {
  const total =
    conversations.reduce((n, c) => n + (c.unread_count || 0), 0) + guestUnread;
  setAppBadge(total);
}
