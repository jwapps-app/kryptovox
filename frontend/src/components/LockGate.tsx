import { useEffect, useRef, useState } from "react";
import { verifyLock } from "../lib/appLock";
import { useAuth } from "../store/auth";

// Full-screen lock shown when app lock is on. Auto-prompts Face ID on mount;
// offers a retry and a sign-out escape (so a failed/unavailable biometric never
// permanently locks the user out — they can re-login).
export default function LockGate({ onUnlock }: { onUnlock: () => void }) {
  const [busy, setBusy] = useState(false);
  const logout = useAuth((s) => s.logout);
  const tried = useRef(false);

  const attempt = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await verifyLock()) onUnlock();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    void attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-white px-8 text-center"
      style={{ height: "var(--vh, 100dvh)" }}
    >
      <svg
        width="56"
        height="56"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-imsg-blue"
        aria-hidden="true"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <div className="text-lg font-semibold">Kryptovox is locked</div>
      <button
        onClick={() => void attempt()}
        disabled={busy}
        className="rounded-xl bg-imsg-blue px-6 py-2.5 font-medium text-white active:opacity-70 disabled:opacity-50"
      >
        {busy ? "Unlocking…" : "Unlock with Face ID"}
      </button>
      <button
        onClick={() => void logout()}
        className="text-sm text-gray-400 active:opacity-60"
      >
        Sign out instead
      </button>
    </div>
  );
}
