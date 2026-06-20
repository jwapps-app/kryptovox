import { useEffect } from "react";

// iOS keyboard handling, ported from the sibling Colloqui app. Sets --vh to the
// real paintable height (max of innerHeight/visualViewport to dodge stale small
// readings), shrinks above the keyboard only when an input is genuinely focused,
// resets iOS's scroll-into-view (which otherwise drags the fixed UI up), and
// re-measures on a short warmup poll to self-heal stale heights.
//
// Used by both the main app and the standalone secret-link guest page so both
// keep their input bar above the on-screen keyboard.
export function useViewportHeight(): void {
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
        const ae = document.activeElement as HTMLElement | null;
        if (
          ae &&
          (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)
        ) {
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
}
