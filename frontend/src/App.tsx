import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import NotesList from "./pages/NotesList";
import CommandPalette from "./components/CommandPalette";
import LockGate from "./components/LockGate";
import ForceTwoFactor from "./components/ForceTwoFactor";
import { isLockEnabled } from "./lib/appLock";
import { api } from "./lib/api";

// The note editor pulls in TipTap (~450KB); load it only when a note is opened.
const NoteEditor = lazy(() => import("./pages/NoteEditor"));

// Deep-link targets must be in-app paths; reject absolute / protocol-relative
// URLs so a hostile push payload can't redirect the app off-site.
const internalPath = (u: unknown): u is string =>
  typeof u === "string" && u.startsWith("/") && !u.startsWith("//");

export default function App() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const bootstrap = useAuth((s) => s.bootstrap);
  const loadGuestUnread = useChat((s) => s.loadGuestUnread);
  const navigate = useNavigate();
  const [locked, setLocked] = useState(() => isLockEnabled());
  const [require2fa, setRequire2fa] = useState(false);

  // Whether the admin requires 2FA (gates the app until the user enrolls).
  useEffect(() => {
    if (status !== "authed") return;
    api<{ require_2fa: boolean }>("/config")
      .then((c) => setRequire2fa(c.require_2fa))
      .catch(() => {});
  }, [status]);
  const hiddenAt = useRef<number | null>(null);

  // Re-lock when the app returns to the foreground after being away a while.
  useEffect(() => {
    const RELOCK_AFTER = 30000;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
      } else if (
        isLockEnabled() &&
        hiddenAt.current &&
        Date.now() - hiddenAt.current > RELOCK_AFTER
      ) {
        setLocked(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

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
      if (e.data?.type === "kv-navigate" && internalPath(e.data.url)) {
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
      if (internalPath(pend)) {
        navigate(pend);
        return;
      }
      const recent = await takeRecentPush();
      if (internalPath(recent)) navigate(recent);
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

  if (locked) {
    return (
      <LockGate
        onUnlock={() => {
          hiddenAt.current = null;
          setLocked(false);
        }}
      />
    );
  }

  if (require2fa && user && !user.twofa_enabled) {
    return (
      <ForceTwoFactor
        onDone={() => useAuth.setState({ user: { ...user, twofa_enabled: true } })}
      />
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
        <Route path="/notes" element={<NotesList />} />
        <Route
          path="/notes/:id"
          element={
            <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}>
              <NoteEditor />
            </Suspense>
          }
        />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CommandPalette />
    </>
  );
}
