import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./store/auth";
import { useWebSocket } from "./hooks/useWebSocket";
import { peekClickLog, takePendingNav } from "./lib/pendingNav";
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
  const navigate = useNavigate();

  // TEMP diagnostic log for push deep-linking; persisted so it survives a resume.
  const [navlog, setNavlog] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("kv_navlog") || "[]");
    } catch {
      return [];
    }
  });
  const dbg = useCallback((line: string) => {
    setNavlog((prev) => {
      const t = new Date().toTimeString().slice(0, 8);
      const next = [`${t} ${line}`, ...prev].slice(0, 7);
      try {
        localStorage.setItem("kv_navlog", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const el = document.createElement("div");
    el.id = "kv-navdbg";
    el.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(0,0,0,.82);color:#0f0;font:9px monospace;padding:2px 5px;white-space:pre-wrap;pointer-events:none";
    document.body.appendChild(el);
    return () => el.remove();
  }, []);
  useEffect(() => {
    const el = document.getElementById("kv-navdbg");
    if (el) el.textContent = `sw:${navigator.serviceWorker?.controller ? "Y" : "N"}\n` + navlog.join("\n");
  }, [navlog]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Deep-link from a tapped push notification (fast path while app is open).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "kv-navigate" && typeof e.data.url === "string") {
        dbg(`swmsg ${e.data.url}`);
        navigate(e.data.url);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [navigate, dbg]);

  useEffect(() => {
    // Read the stashed deep-link target whenever the app becomes visible.
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const st = useAuth.getState().status;
      void peekClickLog().then((cl) => {
        const last = cl[cl.length - 1];
        const age = last ? Math.round((Date.now() - last.ts) / 1000) : -1;
        dbg(`vis st=${st} clicks=${cl.length} last=${last ? last.url + " " + age + "s" : "-"}`);
      });
      if (st !== "authed") return;
      void takePendingNav().then((url) => {
        dbg(`pend=${url || "none"}`);
        if (url) navigate(url);
      });
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [status, navigate, dbg]);

  // iOS keyboard handling, ported from the sibling Colloqui app. Sets --vh to
  // the real paintable height (max of innerHeight/visualViewport to dodge stale
  // small readings), shrinks above the keyboard only when an input is genuinely
  // focused, resets iOS's scroll-into-view (which otherwise drags the fixed UI
  // up), and re-measures on a short warmup poll to self-heal stale heights.
  useEffect(() => {
    const rootStyle = document.documentElement.style;
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
      let kbOpen = false;
      if (isTyping() && vv) {
        const kb = Math.max(0, full - vv.height - vv.offsetTop);
        if (kb > 120) {
          h = vv.height; // sit above the on-screen keyboard
          kbOpen = true;
        }
      }
      rootStyle.setProperty("--vh", `${Math.round(h)}px`);
      // While the keyboard is up there's no home indicator to clear, so the
      // input's bottom safe-area padding must collapse — otherwise it floats
      // ~34px above the keyboard (the gap).
      document.documentElement.classList.toggle("kb-open", kbOpen);
    };
    const pinViewport = () => {
      setViewportHeight();
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
      const se = document.scrollingElement;
      if (se && se.scrollTop) se.scrollTop = 0;
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
