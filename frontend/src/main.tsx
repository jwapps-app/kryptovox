import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { initTheme } from "./lib/theme";
import "./index.css";

// The public guest page is its own chunk so the main app doesn't bundle it.
const GuestView = React.lazy(() => import("./pages/GuestView"));

initTheme(); // set light/dark before first paint to avoid a flash

// Ask the browser not to evict our storage (IndexedDB holds the identity key,
// localStorage holds the session token) so login persists across restarts.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* The public secret-link page renders standalone — no auth, no app
          bootstrap/websocket. Everything else is the full app. */}
      <React.Suspense fallback={null}>
        <Routes>
          <Route path="/g/:id" element={<GuestView />} />
          <Route path="*" element={<App />} />
        </Routes>
      </React.Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
