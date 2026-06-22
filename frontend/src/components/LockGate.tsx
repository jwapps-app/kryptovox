import { useEffect, useRef, useState } from "react";
import { lockMethod, verifyBiometric, verifyPin } from "../lib/appLock";
import { useAuth } from "../store/auth";

// Full-screen lock. Branches on the configured method: a Face ID prompt
// (WebAuthn) or a numeric PIN. A sign-out escape prevents permanent lockout.
export default function LockGate({ onUnlock }: { onUnlock: () => void }) {
  const method = lockMethod();
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const logout = useAuth((s) => s.logout);
  const tried = useRef(false);

  const attemptBiometric = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await verifyBiometric()) onUnlock();
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      if (await verifyPin(value)) onUnlock();
      else {
        setError(true);
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (tried.current || method !== "biometric") return;
    tried.current = true;
    void attemptBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-white px-8 text-center"
      style={{ height: "var(--vh, 100dvh)" }}
    >
      <svg
        width="52"
        height="52"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={error ? "text-red-500" : "text-imsg-blue"}
        aria-hidden="true"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <div className="text-lg font-semibold">Kryptovox is locked</div>

      {method === "pin" ? (
        <div className="flex w-full max-w-[220px] flex-col items-center gap-3">
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pin.length >= 4) void submitPin(pin);
            }}
            placeholder="••••"
            className={`w-full rounded-xl border px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none ${
              error ? "border-red-400" : "border-gray-300 focus:border-imsg-blue"
            }`}
          />
          {error && <div className="text-sm text-red-500">Wrong PIN</div>}
          <button
            onClick={() => void submitPin(pin)}
            disabled={busy || pin.length < 4}
            className="w-full rounded-xl bg-imsg-blue py-2.5 font-medium text-white active:opacity-70 disabled:opacity-50"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </div>
      ) : (
        <button
          onClick={() => void attemptBiometric()}
          disabled={busy}
          className="rounded-xl bg-imsg-blue px-6 py-2.5 font-medium text-white active:opacity-70 disabled:opacity-50"
        >
          {busy ? "Unlocking…" : "Unlock with passkey"}
        </button>
      )}

      <button onClick={() => void logout()} className="text-sm text-gray-400 active:opacity-60">
        Sign out instead
      </button>
    </div>
  );
}
