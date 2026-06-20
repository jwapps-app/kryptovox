// Self-destroying service worker.
//
// Kryptovox no longer uses a service worker. This file exists ONLY to remove
// any old SW still installed on a device: the browser fetches it as an update
// to the previously-registered SW, installs it, and on activation it deletes
// all caches, unregisters itself, and reloads the page so the plain (no-SW)
// app takes over. Browsers that never had a SW never request this file.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) client.navigate(client.url);
      } catch (e) {
        /* best effort */
      }
    })()
  );
});
