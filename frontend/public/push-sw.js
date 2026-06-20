/* Push-only service worker.
 *
 * Deliberately minimal: it has NO `fetch` handler and does NO caching, so it
 * can never intercept navigations or serve stale assets — the exact failure
 * mode that sank the previous precaching PWA service worker. Its sole job is to
 * show notifications pushed from the server and route taps back into the app.
 * nginx serves this file with `no-store`, so updates to it land immediately.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    /* non-JSON payload — fall back to defaults */
  }
  const title = data.title || "Kryptovox";
  const url = data.url || "/";
  // Update the app-icon badge count (Badging API) even though the app is closed.
  if (typeof data.badge === "number" && self.navigator.setAppBadge) {
    if (data.badge > 0) self.navigator.setAppBadge(data.badge).catch(() => {});
    else if (self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "New message",
      icon: "/icon-192.png",
      badge: "/icon-192.png", // monochrome status-bar glyph, not the count
      data: { url },
      tag: url, // collapse repeats from the same conversation into one banner
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch (_) {
              /* cross-origin or not allowed — focus is enough */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
