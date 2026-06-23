import { useState } from "react";
import { api } from "../lib/api";

// TOTP enrollment flow: setup → show secret → verify a code → show backup codes.
// Calls onEnabled once 2FA is active. Reused in Settings and the forced gate.
export default function TwoFactorSetup({
  onEnabled,
  onCancel,
}: {
  onEnabled: () => void;
  onCancel?: () => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ secret: string; provisioning_uri: string }>(
        "/2fa/totp/setup",
        { method: "POST" }
      );
      setSecret(r.secret);
      setUri(r.provisioning_uri);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ codes: string[] }>("/2fa/totp/verify", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setCodes(r.codes);
    } catch {
      setErr("That code didn't match. Wait for the next one and try again.");
    } finally {
      setBusy(false);
    }
  };

  // Step 3: backup codes (shown once).
  if (codes) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">Save your backup codes</p>
        <p className="text-xs text-gray-500">
          Each can be used once if you lose your authenticator. Store them
          somewhere safe — they won’t be shown again.
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-3 font-mono text-sm">
          {codes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <button
          onClick={onEnabled}
          className="w-full rounded-xl bg-imsg-blue py-2.5 font-medium text-white active:opacity-70"
        >
          I’ve saved them
        </button>
      </div>
    );
  }

  // Step 2: show secret + verify a code.
  if (secret) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Add this secret to your authenticator app (or password manager), then
          enter the 6-digit code it shows.
        </p>
        <div className="select-all break-all rounded-xl bg-gray-100 p-3 text-center font-mono text-sm">
          {secret}
        </div>
        <a href={uri} className="block text-center text-xs text-imsg-blue">
          Open in authenticator app
        </a>
        <input
          autoFocus
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-center text-[17px] tracking-widest outline-none focus:border-imsg-blue"
          placeholder="123456"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
        />
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button
          onClick={() => void verify()}
          disabled={busy || code.trim().length < 6}
          className="w-full rounded-xl bg-imsg-blue py-2.5 font-medium text-white active:opacity-70 disabled:opacity-50"
        >
          {busy ? "…" : "Verify & enable"}
        </button>
      </div>
    );
  }

  // Step 1: intro.
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Protect your account with a second factor — a rotating code from an
        authenticator app or your password manager.
      </p>
      {err && <p className="text-sm text-red-500">{err}</p>}
      <button
        onClick={() => void start()}
        disabled={busy}
        className="w-full rounded-xl bg-imsg-blue py-2.5 font-medium text-white active:opacity-70 disabled:opacity-50"
      >
        {busy ? "…" : "Set up two-factor"}
      </button>
      {onCancel && (
        <button onClick={onCancel} className="w-full text-center text-sm text-gray-400">
          Cancel
        </button>
      )}
    </div>
  );
}
