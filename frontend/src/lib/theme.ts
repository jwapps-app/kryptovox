import { getPrefs } from "./prefs";

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// Toggle the `dark` class on <html> based on the saved theme pref.
export function applyTheme(): void {
  const theme = getPrefs().theme;
  const dark = theme === "dark" || (theme === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
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
