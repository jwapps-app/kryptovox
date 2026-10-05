import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  attestPasskey,
  preloadPasskeyRegisterOptions,
  verifyPasskeyRegister,
  type PasskeyOptions,
} from "../lib/passkey";
import { usePasswordPrompt } from "./PasswordPrompt";

// TOTP enrollment flow: setup → show secret → verify a code → show backup codes.
// Calls onEnabled once 2FA is active. Reused in Settings and the forced gate.
//
// Enrolling a factor is a step-up action (the server takes the password), so
// each path starts with a password prompt. For passkeys that means two taps:
// one to confirm the password and fetch the WebAuthn options, a second to run
// the WebAuthn ceremony — it must be the first await after a tap on iOS Safari.
export default function TwoFactorSetup({
  onEnabled,
  onCancel,
  forceTotp,
}: {
  onEnabled: () => void;
  onCancel?: () => void;
  forceTotp?: boolean; // skip the choice, go straight to authenticator setup
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regOpts, setRegOpts] = useState<PasskeyOptions | null>(null);
  const { ask, element: passwordPrompt } = usePasswordPrompt();

  useEffect(() => {
    if (forceTotp) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceTotp]);

  // Step 1 of the passkey path: confirm the password, fetch the options.
  const preparePasskey = async () => {
    setErr(null);
    const password = await ask("Confirm your password", "Adding a passkey as a second factor.");
    if (!password) return;
    setBusy(true);
    try {
      setRegOpts(await preloadPasskeyRegisterOptions(password));
    } catch (e) {
      setErr((e as Error).message || "Couldn't start passkey setup.");
    } finally {
      setBusy(false);
    }
  };

  // Step 2: the WebAuthn ceremony, from its own tap.
  const addPasskey = async () => {
    if (!regOpts) return;
    setErr(null);
    let credential: unknown;
    try {
      credential = await attestPasskey(regOpts.options); // must be first await
    } catch (e) {
      const name = (e as Error)?.name || "Error";
      const msg = (e as Error)?.message || "";
      setErr(`Couldn't add a passkey — ${name}${msg ? `: ${msg}` : ""}`);
      return;
    }
    setBusy(true);
    try {
      const c = await verifyPasskeyRegister(regOpts.challenge_token, credential, "Passkey");
      if (c.length) setCodes(c);
      else onEnabled();
    } catch {
      setErr("Passkey registration failed.");
    } finally {
      setRegOpts(null);
      setBusy(false);
    }
  };

  const start = async () => {
    setErr(null);
    const password = await ask("Confirm your password", "Adding an authenticator app as a second factor.");
    if (!password) {
      onCancel?.();
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ secret: string; provisioning_uri: string }>("/2fa/totp/setup", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
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
      if (r.codes.length) setCodes(r.codes);
      else onEnabled(); // adding a second method — no new backup codes to show
      return;
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
        <label className="block">
          <span className="sr-only">Authenticator code</span>
          <input
            autoFocus
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-center text-[17px] tracking-widest outline-hidden focus:border-imsg-blue"
            aria-label="Verification code"
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
          />
        </label>
        {err && (
          <p className="text-sm text-red-500" role="alert">
            {err}
          </p>
        )}
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

  // forceTotp: start() is prompting / fetching; don't flash the choice screen.
  if (forceTotp) {
    return (
      <div className="space-y-2">
        {passwordPrompt}
        {err ? (
          <p className="text-sm text-red-500" role="alert">
            {err}
          </p>
        ) : (
          <p className="text-sm text-gray-400">Setting up…</p>
        )}
        {onCancel && (
          <button onClick={onCancel} className="text-sm text-gray-400">
            Cancel
          </button>
        )}
      </div>
    );
  }

  // Step 1: choose a method.
  return (
    <div className="space-y-3">
      {passwordPrompt}
      <p className="text-sm text-gray-500">
        Add a second factor to protect your account. Choose a method:
      </p>
      {err && (
        <p className="text-sm text-red-500" role="alert">
          {err}
        </p>
      )}
      {regOpts ? (
        <button
          onClick={() => void addPasskey()}
          disabled={busy}
          className="w-full rounded-xl bg-imsg-blue py-3 font-medium text-white active:opacity-70 disabled:opacity-50"
        >
          Create passkey now
        </button>
      ) : (
        <button
          onClick={() => void preparePasskey()}
          disabled={busy}
          className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-left active:bg-gray-50 disabled:opacity-50"
        >
          <span>
            <span className="block font-medium">Passkey</span>
            <span className="block text-xs text-gray-400">
              Face ID / Touch ID or your password manager
            </span>
          </span>
          <span className="text-gray-300" aria-hidden="true">
            ›
          </span>
        </button>
      )}
      <button
        onClick={() => void start()}
        disabled={busy}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-left active:bg-gray-50 disabled:opacity-50"
      >
        <span>
          <span className="block font-medium">Authenticator app</span>
          <span className="block text-xs text-gray-400">
            A rotating code (works with your password manager)
          </span>
        </span>
        <span className="text-gray-300" aria-hidden="true">
          ›
        </span>
      </button>
      {onCancel && (
        <button onClick={onCancel} className="w-full text-center text-sm text-gray-400">
          Cancel
        </button>
      )}
    </div>
  );
}
