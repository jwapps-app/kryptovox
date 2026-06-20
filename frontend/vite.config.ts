import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// Plain SPA — no service worker / PWA. The app loads fresh from the network
// every time (index.html is served no-cache by nginx; JS/CSS are content-hashed),
// so there's no stale-build / stale-SW problem.

// Local HTTPS via mkcert (needed for Web Crypto from a phone over the LAN IP).
const certDir = path.resolve(__dirname, "certs");
const certPath = path.join(certDir, "cert.pem");
const keyPath = path.join(certDir, "key.pem");
const wantsHttps = process.env.VITE_DEV_HTTPS === "true";
const httpsAvailable = wantsHttps && fs.existsSync(certPath) && fs.existsSync(keyPath);

// In docker-compose the backend is reachable as `backend`; bare-metal it's localhost.
const proxyTarget = process.env.VITE_PROXY_TARGET || "http://localhost:8000";

// Build marker shown in Settings so we can tell which build is running.
const buildId =
  process.env.GITHUB_SHA?.slice(0, 7) ||
  new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // macOS Docker bind mounts don't deliver native FS events, so Vite's
    // watcher misses edits and serves stale transforms. Poll instead.
    watch: { usePolling: true, interval: 300 },
    https: httpsAvailable
      ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
      : undefined,
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
