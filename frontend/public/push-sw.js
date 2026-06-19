// Custom push handlers, imported into the Workbox-generated service worker.
// The payload never contains message plaintext — only sender name + deep link.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "Kryptovox";
  const options = {
    body: data.body || "New message",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    tag: data.url || "kryptovox",
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          if ("focus" in w) {
            w.navigate(url);
            return w.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});
