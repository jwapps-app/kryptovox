import { getPrefs } from "./prefs";

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// Toggle the `dark` class on <html> based on the saved theme pref, and update
// the theme-color meta so the iOS PWA status bar re-tints without a relaunch.
export function applyTheme(): void {
  const theme = getPrefs().theme;
  const dark = theme === "dark" || (theme === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#000000" : "#ffffff");
}

export function initTheme(): void {
  applyTheme();
  // Follow the OS when the pref is "system".
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener?.("change", () => {
      if (getPrefs().theme === "system") applyTheme();
    });
}
