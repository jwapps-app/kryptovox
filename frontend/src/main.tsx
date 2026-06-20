import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Ask the browser not to evict our storage (IndexedDB holds the identity key,
// localStorage holds the session token) so login persists across restarts.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
