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

// Sum the unread counts across all conversations and reflect it on the icon.
export function syncBadge(conversations: { unread_count: number }[]): void {
  const total = conversations.reduce((n, c) => n + (c.unread_count || 0), 0);
  setAppBadge(total);
}
