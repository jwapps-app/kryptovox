import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";

// Local HTTPS via mkcert. Generate with:
//   mkcert -install
//   mkcert -cert-file frontend/certs/cert.pem -key-file frontend/certs/key.pem \
//          localhost 127.0.0.1 <your-mac-LAN-IP>
// HTTPS (and thus Web Crypto + service workers) then works from your phone too.
const certDir = path.resolve(__dirname, "certs");
const certPath = path.join(certDir, "cert.pem");
const keyPath = path.join(certDir, "key.pem");
const wantsHttps = process.env.VITE_DEV_HTTPS === "true";
const httpsAvailable = wantsHttps && fs.existsSync(certPath) && fs.existsSync(keyPath);

// In docker-compose the backend is reachable as `backend`; bare-metal it's localhost.
const proxyTarget = process.env.VITE_PROXY_TARGET || "http://localhost:8000";

// Build marker shown in Settings so we can tell fresh code from stale cache.
const buildId =
  process.env.GITHUB_SHA?.slice(0, 7) ||
  new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Kryptovox",
        short_name: "Kryptovox",
        description: "End-to-end encrypted messaging",
        theme_color: "#007AFF",
        background_color: "#FFFFFF",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Do NOT precache or serve the app shell from the SW — that's what kept
        // serving stale builds. The SW exists only to receive push; the app
        // itself always loads fresh from the network.
        globPatterns: [],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        importScripts: ["push-sw.js"],
      },
      // Register the SW in dev too so push can be tested in the dev stack.
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
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
