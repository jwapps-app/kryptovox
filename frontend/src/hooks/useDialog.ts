import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Dialog behaviour for the app's sheets and modals: Escape closes, Tab stays
// inside, focus lands on the first control on open and returns to the element
// that opened the dialog on close. Pair with role="dialog" aria-modal="true"
// (and an aria-label) on the element `ref` points at.
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const root = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (root && !root.contains(document.activeElement)) {
      root.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [ref, onClose]);
}
