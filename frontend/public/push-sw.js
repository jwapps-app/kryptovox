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

function stashLastPush(url) {
  return new Promise((resolve) => {
    let open;
    try {
      open = indexedDB.open("kryptovox-push", 1);
    } catch (_) {
      resolve();
      return;
    }
    open.onupgradeneeded = () => open.result.createObjectStore("nav");
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("nav", "readwrite");
      tx.objectStore("nav").put({ url: url, ts: Date.now() }, "lastpush");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    };
    open.onerror = () => resolve();
  });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    /* non-JSON payload — fall back to defaults */
  }
  const title = data.title || "Kryptovox";
  const url = data.url || "/";
  event.waitUntil(
    (async () => {
      const tasks = [
        self.registration.showNotification(title, {
          body: data.body || "New message",
          icon: "/icon-192.png",
          badge: "/icon-192.png", // monochrome status-bar glyph, not the count
          data: { url },
          tag: url, // collapse repeats from the same conversation into one banner
        }),
      ];
      // Update the app-icon badge count (Badging API). This MUST be awaited
      // inside waitUntil — when the app is force-closed the worker is killed the
      // moment waitUntil settles, so a fire-and-forget call never lands.
      if (typeof data.badge === "number") {
        if (data.badge > 0 && self.navigator.setAppBadge) {
          tasks.push(self.navigator.setAppBadge(data.badge));
        } else if (self.navigator.clearAppBadge) {
          tasks.push(self.navigator.clearAppBadge());
        }
      }
      await Promise.all(tasks.map((p) => p && p.catch(() => {})));
      // iOS doesn't fire notificationclick on a background resume, so stash the
      // target here (the push DOES run). Only when the app isn't actively in
      // use — otherwise opening the app for another reason could mis-navigate.
      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const active = wins.some((c) => c.focused || c.visibilityState === "visible");
      if (!active) await stashLastPush(url);
    })()
  );
});

// Stash a pending deep-link target so a cold-started app (iOS launches the PWA
// at its start screen and ignores the notification URL) can pick it up on load.
function savePendingNav(url) {
  return new Promise((resolve) => {
    let open;
    try {
      open = indexedDB.open("kryptovox-push", 1);
    } catch (_) {
      resolve();
      return;
    }
    open.onupgradeneeded = () => open.result.createObjectStore("nav");
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("nav", "readwrite");
      const store = tx.objectStore("nav");
      store.put({ url: url, ts: Date.now() }, "pending");
      // Diagnostic: keep a non-consuming log of clicks so the app can confirm
      // notificationclick fired even if it can't act on it.
      const getLog = store.get("clicklog");
      getLog.onsuccess = () => {
        const log = Array.isArray(getLog.result) ? getLog.result : [];
        log.push({ url: url, ts: Date.now() });
        while (log.length > 6) log.shift();
        store.put(log, "clicklog");
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    };
    open.onerror = () => resolve();
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      // Always stash the target: iOS resumes the already-loaded PWA without
      // delivering this worker's postMessage, so the app reads the stash when it
      // becomes visible. postMessage + openWindow below are fast-paths on top.
      await savePendingNav(url);
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (clients.length) {
        await clients[0].focus();
        clients[0].postMessage({ type: "kv-navigate", url: url });
        return;
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
