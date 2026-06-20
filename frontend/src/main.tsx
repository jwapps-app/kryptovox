import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// Auto-update the service worker, and actively re-check for a new version when
// the app regains focus — otherwise iOS PWAs can run a stale cached build for a
// long time. With autoUpdate, finding a new SW triggers skipWaiting + reload.
// Ask the browser not to evict our storage (IndexedDB holds the identity key);
// keeps installed PWAs logged in across closes.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (!document.hidden) registration.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    setInterval(check, 60 * 60 * 1000);
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
