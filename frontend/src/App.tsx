import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./store/auth";
import { useWebSocket } from "./hooks/useWebSocket";
import Login from "./pages/Login";
import ConversationList from "./pages/ConversationList";
import ChatView from "./pages/ChatView";
import ChatInfo from "./pages/ChatInfo";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import CommandPalette from "./components/CommandPalette";

export default function App() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // iOS keyboard handling, ported from the sibling Colloqui app. Sets --vh to
  // the real paintable height (max of innerHeight/visualViewport to dodge stale
  // small readings), shrinks above the keyboard only when an input is genuinely
  // focused, resets iOS's scroll-into-view (which otherwise drags the fixed UI
  // up), and re-measures on a short warmup poll to self-heal stale heights.
  useEffect(() => {
    const rootStyle = document.documentElement.style;
    // TEMP debug readout (top-left) — shows live viewport metrics on the phone.
    const dbg = document.createElement("div");
    dbg.id = "vpdebug";
    dbg.style.cssText =
      "position:fixed;top:0;left:0;z-index:99999;background:rgba(0,0,0,.75);color:#0f0;font:10px monospace;padding:2px 5px;pointer-events:none;white-space:nowrap";
    document.body.appendChild(dbg);
    const isTyping = () => {
      const ae = document.activeElement as HTMLElement | null;
      return (
        !!ae &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)
      );
    };
    const setViewportHeight = () => {
      const vv = window.visualViewport;
      const inner = window.innerHeight;
      const full = vv ? Math.max(inner, vv.height) : inner;
      let h = full;
      if (isTyping() && vv) {
        const kb = Math.max(0, full - vv.height - vv.offsetTop);
        if (kb > 120) h = vv.height; // sit above the on-screen keyboard
      }
      rootStyle.setProperty("--vh", `${Math.round(h)}px`);
    };
    const pinViewport = () => {
      setViewportHeight();
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
      const se = document.scrollingElement;
      if (se && se.scrollTop) se.scrollTop = 0;
      const vv = window.visualViewport;
      const standalone =
        (window.navigator as { standalone?: boolean }).standalone ||
        window.matchMedia("(display-mode: standalone)").matches;
      dbg.textContent =
        `vh:${rootStyle.getPropertyValue("--vh")} in:${window.innerHeight} ` +
        `vv:${vv ? Math.round(vv.height) : "-"} off:${vv ? Math.round(vv.offsetTop) : "-"} ` +
        `typ:${isTyping() ? "Y" : "N"} sa:${standalone ? "PWA" : "tab"}`;
    };
    let warmup: ReturnType<typeof setInterval> | undefined;
    const rearm = () => {
      let ticks = 0;
      if (warmup) clearInterval(warmup);
      warmup = setInterval(() => {
        pinViewport();
        if (++ticks > 14) {
          clearInterval(warmup);
          warmup = undefined;
        }
      }, 150);
    };

    pinViewport();
    rearm();

    const winEvents = ["resize", "orientationchange", "pageshow", "focus"];
    winEvents.forEach((e) => window.addEventListener(e, pinViewport));
    window.addEventListener("pageshow", rearm);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", pinViewport);
    vv?.addEventListener("scroll", pinViewport);
    const onVisibility = () => {
      if (document.hidden) {
        // Drop keyboard focus on the way out so a stale "focused" state doesn't
        // shrink the layout for a keyboard that isn't actually shown on return.
        const ae = document.activeElement as HTMLElement | null;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) {
          ae.blur();
        }
      } else {
        pinViewport();
        rearm();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onFocusIn = () => {
      pinViewport();
      setTimeout(pinViewport, 50);
      setTimeout(pinViewport, 300);
    };
    document.addEventListener("focusin", onFocusIn);

    return () => {
      dbg.remove();
      if (warmup) clearInterval(warmup);
      winEvents.forEach((e) => window.removeEventListener(e, pinViewport));
      window.removeEventListener("pageshow", rearm);
      vv?.removeEventListener("resize", pinViewport);
      vv?.removeEventListener("scroll", pinViewport);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

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
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CommandPalette />
    </>
  );
}
