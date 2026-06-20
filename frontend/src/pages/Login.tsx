import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";

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
  const [diag, setDiag] = useState("checking storage…");

  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const error = useAuth((s) => s.error);

  useEffect(() => {
    api<{ needs_setup: boolean }>("/auth/setup-status")
      .then((s) => setNeedsSetup(s.needs_setup))
      .catch(() => setNeedsSetup(false));
  }, []);

  // Diagnostic: what survived in storage? Helps debug "logged out on reopen".
  useEffect(() => {
    (async () => {
      const tok = (() => {
        try {
          return localStorage.getItem("kv_rt");
        } catch {
          return null;
        }
      })();
      const keyCount = await new Promise<string | number>((res) => {
        try {
          const o = indexedDB.open("kryptovox");
          o.onsuccess = () => {
            try {
              const t = o.result.transaction("identity", "readonly").objectStore("identity").count();
              t.onsuccess = () => res(t.result);
              t.onerror = () => res("err");
            } catch {
              res("nostore");
            }
          };
          o.onerror = () => res("dberr");
        } catch {
          res("idb-blocked");
        }
      });
      let refreshInfo = "refresh: -";
      try {
        const r = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: tok }),
        });
        refreshInfo = `refresh: ${r.status}`;
      } catch (e) {
        refreshInfo = `refresh: ERR ${(e as Error).message.slice(0, 30)}`;
      }
      setDiag(
        `token: ${tok ? tok.length : "NONE"} · key: ${keyCount} · ${refreshInfo}`
      );
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (needsSetup) {
        await register(username.trim(), password, displayName.trim(), deviceName.trim());
      } else {
        await login(username.trim(), password, deviceName.trim());
      }
    } catch {
      /* error shown from store */
    } finally {
      setBusy(false);
    }
  };

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
          <p className="mt-4 text-center text-xs text-gray-400">
            Registration is by invitation. Ask an admin to create your account.
          </p>
        )}
        <p className="mt-3 text-center font-mono text-[11px] text-gray-400">{diag}</p>
      </form>
    </div>
  );
}
