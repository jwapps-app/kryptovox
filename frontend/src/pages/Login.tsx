import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import {
  type EncryptedKeyBlob,
  normalizeRecoveryKey,
  recoverIdentity,
  recoveryVerifier,
  wrapPrivateKey,
} from "../crypto/identity";

const defaultDeviceName = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Win/.test(ua)) return "PC";
  return "This device";
};

export default function Login() {
  // Bootstrap: the very first account is the server admin. Until then we show
  // the "create account" form; afterwards registration is admin-only and this
  // screen is sign-in only.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [busy, setBusy] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoverErr, setRecoverErr] = useState<string | null>(null);

  const login = useAuth((s) => s.login);
  const complete2fa = useAuth((s) => s.complete2fa);
  const complete2faPasskey = useAuth((s) => s.complete2faPasskey);
  const register = useAuth((s) => s.register);
  const error = useAuth((s) => s.error);

  useEffect(() => {
    api<{ needs_setup: boolean }>("/auth/setup-status")
      .then((s) => setNeedsSetup(s.needs_setup))
      .catch(() => setNeedsSetup(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (needsSetup) {
        await register(username.trim(), password, displayName.trim(), deviceName.trim());
      } else {
        const res = await login(username.trim(), password, deviceName.trim());
        if (res.twofaRequired && res.pendingToken) {
          setPendingToken(res.pendingToken);
          setMethods(res.methods ?? []);
        }
      }
    } catch {
      /* error shown from store */
    } finally {
      setBusy(false);
    }
  };

  const submit2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingToken) return;
    setBusy(true);
    try {
      await complete2fa(pendingToken, code.trim(), password, deviceName.trim());
    } catch {
      /* error shown from store */
    } finally {
      setBusy(false);
    }
  };

  const submitRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setRecoverErr(null);
    try {
      const verifier = await recoveryVerifier(recoveryKey);
      const begin = await api<{
        recovery_key_blob: EncryptedKeyBlob;
        identity_public_key: string;
      }>("/recovery/begin", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), recovery_verifier: verifier }),
      });
      const id = await recoverIdentity(
        begin.identity_public_key,
        begin.recovery_key_blob,
        normalizeRecoveryKey(recoveryKey)
      );
      const newBlob = await wrapPrivateKey(id.privateKey, newPassword);
      await api("/recovery/finish", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          recovery_verifier: verifier,
          new_password: newPassword,
          encrypted_private_key: newBlob,
        }),
      });
      // Sign in with the new password (handles 2FA if it's enabled).
      setRecovering(false);
      setPassword(newPassword);
      const res = await login(username.trim(), newPassword, deviceName.trim());
      if (res.twofaRequired && res.pendingToken) setPendingToken(res.pendingToken);
    } catch {
      setRecoverErr("Couldn't recover. Check your username and recovery key.");
    } finally {
      setBusy(false);
    }
  };

  if (recovering) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 px-6">
        <form
          onSubmit={submitRecovery}
          className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm"
        >
          <h1 className="mb-1 text-center text-2xl font-semibold">Recover account</h1>
          <p className="mb-6 text-center text-sm text-gray-500">
            Enter your recovery key and choose a new password.
          </p>
          <input
            className="mb-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-[17px] outline-none focus:border-imsg-blue"
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            className="mb-3 w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-[15px] outline-none focus:border-imsg-blue"
            placeholder="Recovery key"
            autoCapitalize="characters"
            autoCorrect="off"
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            required
          />
          <input
            className="mb-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-[17px] outline-none focus:border-imsg-blue"
            placeholder="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
          {recoverErr && <p className="mb-3 text-sm text-red-500">{recoverErr}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-imsg-blue py-3 text-[17px] font-medium text-white disabled:opacity-50"
          >
            {busy ? "…" : "Recover & sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRecovering(false);
              setRecoverErr(null);
            }}
            className="mt-3 w-full text-center text-sm text-gray-400"
          >
            Back
          </button>
        </form>
      </div>
    );
  }

  const usePasskey = async () => {
    if (!pendingToken) return;
    setBusy(true);
    try {
      await complete2faPasskey(pendingToken, password, deviceName.trim());
    } catch {
      /* error from store */
    } finally {
      setBusy(false);
    }
  };

  if (pendingToken) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 px-6">
        <form onSubmit={submit2fa} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-center text-2xl font-semibold">Two-factor</h1>
          <p className="mb-6 text-center text-sm text-gray-500">
            {methods.includes("passkey") && methods.includes("totp")
              ? "Use your passkey, or enter a code."
              : methods.includes("passkey")
                ? "Use your passkey, or a backup code."
                : "Enter the code from your authenticator app, or a backup code."}
          </p>
          {methods.includes("passkey") && (
            <button
              type="button"
              onClick={() => void usePasskey()}
              disabled={busy}
              className="mb-4 w-full rounded-xl bg-imsg-blue py-3 text-[17px] font-medium text-white disabled:opacity-50"
            >
              {busy ? "…" : "Use passkey"}
            </button>
          )}
          <input
            autoFocus
            className="mb-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-[17px] tracking-widest outline-none focus:border-imsg-blue"
            placeholder="123456"
            autoCapitalize="none"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="w-full rounded-xl bg-imsg-blue py-3 text-[17px] font-medium text-white disabled:opacity-50"
          >
            {busy ? "…" : "Verify"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingToken(null);
              setCode("");
            }}
            className="mt-3 w-full text-center text-sm text-gray-400"
          >
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-50 px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm"
      >
        <h1 className="mb-1 text-center text-2xl font-semibold">Kryptovox</h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          {needsSetup
            ? "Set up your server — this account will be the admin"
            : "End-to-end encrypted messaging"}
        </p>

        <input
          className="mb-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-[17px] outline-none focus:border-imsg-blue"
          placeholder="Username"
          autoCapitalize="none"
          autoCorrect="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        {needsSetup && (
          <input
            className="mb-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-[17px] outline-none focus:border-imsg-blue"
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}
        <input
          className="mb-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-[17px] outline-none focus:border-imsg-blue"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <input
          className="mb-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-[17px] outline-none focus:border-imsg-blue"
          placeholder="Device name"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />

        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={busy || needsSetup === null}
          className="w-full rounded-xl bg-imsg-blue py-3 text-[17px] font-medium text-white disabled:opacity-50"
        >
          {busy ? "…" : needsSetup ? "Create admin account" : "Sign in"}
        </button>

        {!needsSetup && (
          <>
            <button
              type="button"
              onClick={() => setRecovering(true)}
              className="mt-4 w-full text-center text-sm text-imsg-blue"
            >
              Forgot password?
            </button>
            <p className="mt-3 text-center text-xs text-gray-400">
              Registration is by invitation. Ask an admin to create your account.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
