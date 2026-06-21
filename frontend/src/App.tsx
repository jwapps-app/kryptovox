import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./store/auth";
import { useChat } from "./store/chat";
import { useWebSocket } from "./hooks/useWebSocket";
import { useViewportHeight } from "./hooks/useViewportHeight";
import { takePendingNav, takeRecentPush } from "./lib/pendingNav";
import Login from "./pages/Login";
import ConversationList from "./pages/ConversationList";
import ChatView from "./pages/ChatView";
import ChatInfo from "./pages/ChatInfo";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import SecretLinkThread from "./pages/SecretLinkThread";
import CommandPalette from "./components/CommandPalette";

export default function App() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  const loadGuestUnread = useChat((s) => s.loadGuestUnread);
  const navigate = useNavigate();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Seed the secret-link unread count (and badge) once signed in.
  useEffect(() => {
    if (status === "authed") void loadGuestUnread();
  }, [status, loadGuestUnread]);

  // Deep-link from a tapped push notification (fast path while the app is open).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "kv-navigate" && typeof e.data.url === "string") {
        navigate(e.data.url);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [navigate]);

  useEffect(() => {
    // On every become-visible, route to the target the SW stashed: `pending`
    // from a cold-launch notificationclick, or `lastpush` from the push event
    // (covers the iOS background-resume case where notificationclick doesn't
    // fire). Both clear themselves, so each fires once.
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      if (useAuth.getState().status !== "authed") return;
      void useChat.getState().loadGuestUnread(); // refresh secret-link badge on resume
      const pend = await takePendingNav();
      if (pend) {
        navigate(pend);
        return;
      }
      const recent = await takeRecentPush();
      if (recent) navigate(recent);
    };
    void check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [status, navigate]);

  useViewportHeight();
  useWebSocket();

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        Loading…
      </div>
    );
  }

  if (status === "anon") {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<ConversationList />} />
        <Route path="/chat/:id" element={<ChatView />} />
        <Route path="/chat/:id/info" element={<ChatInfo />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/links/:id" element={<SecretLinkThread />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CommandPalette />
    </>
  );
}
