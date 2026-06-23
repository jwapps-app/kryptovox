import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import {
  generateRecoveryKey,
  normalizeRecoveryKey,
  recoveryVerifier,
  wrapPrivateKey,
} from "../crypto/identity";

// Generate a recovery key, show it once, and upload the recovery-key-wrapped
// private key + verifier. The server never sees the key itself.
export default function RecoveryKeySetup({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel?: () => void;
}) {
  const identity = useAuth((s) => s.identity);
  const [key] = useState(() => generateRecoveryKey());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!identity) return;
    setBusy(true);
    setErr(null);
    try {
      const norm = normalizeRecoveryKey(key);
      const blob = await wrapPrivateKey(identity.privateKey, norm);
      const verifier = await recoveryVerifier(key);
      await api("/recovery/setup", {
        method: "POST",
        body: JSON.stringify({ recovery_key_blob: blob, recovery_verifier: verifier }),
      });
      const u = useAuth.getState().user;
      if (u) useAuth.setState({ user: { ...u, has_recovery: true } });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Save this recovery key somewhere safe (e.g. your password manager). If you
        forget your password, it’s the only way to regain access without losing
        your messages.
      </p>
      <div className="select-all break-all rounded-xl bg-gray-100 p-3 text-center font-mono text-sm tracking-wide">
        {key}
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}
      <button
        onClick={() => void save()}
        disabled={busy}
        className="w-full rounded-xl bg-imsg-blue py-2.5 font-medium text-white active:opacity-70 disabled:opacity-50"
      >
        {busy ? "…" : "I’ve saved it"}
      </button>
      {onCancel && (
        <button onClick={onCancel} className="w-full text-center text-sm text-gray-400">
          Cancel
        </button>
      )}
    </div>
  );
}
