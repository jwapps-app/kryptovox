import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import Avatar from "../components/Avatar";
import type { AdminUser } from "../lib/types";

export default function Admin() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user)!;
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  // New-user form
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [defaultRetention, setDefaultRetention] = useState(0);
  const [retentionSaved, setRetentionSaved] = useState(false);

  const load = () => api<AdminUser[]>("/admin/users").then(setUsers).catch(() => {});

  useEffect(() => {
    if (!me.is_admin) {
      navigate("/settings");
      return;
    }
    void load();
    api<{ default_retention_days: number }>("/config")
      .then((c) => setDefaultRetention(c.default_retention_days))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveRetention = async (days: number) => {
    const c = await api<{ default_retention_days: number }>("/config", {
      method: "PUT",
      body: JSON.stringify({ default_retention_days: days }),
    });
    setDefaultRetention(c.default_retention_days);
    setRetentionSaved(true);
    setTimeout(() => setRetentionSaved(false), 1500);
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password,
          display_name: displayName.trim() || null,
          is_admin: makeAdmin,
        }),
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setMakeAdmin(false);
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAdmin = async (u: AdminUser) => {
    await api(`/admin/users/${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_admin: !u.is_admin }),
    }).catch((e) => setError((e as Error).message));
    void load();
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`Delete ${u.username}? This cannot be undone.`)) return;
    await api(`/admin/users/${u.id}`, { method: "DELETE" }).catch((e) =>
      setError((e as Error).message)
    );
    void load();
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <button className="text-2xl text-imsg-blue" onClick={() => navigate("/settings")}>
          ‹
        </button>
        <span className="font-semibold">Admin · Users</span>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase text-gray-400">
          Default message retention
        </h2>
        <div className="mb-6 rounded-2xl bg-white p-2 shadow-sm">
          {[
            { days: 0, label: "Forever" },
            { days: 7, label: "7 days" },
            { days: 30, label: "30 days" },
            { days: 90, label: "90 days" },
            { days: 365, label: "1 year" },
          ].map((opt) => (
            <button
              key={opt.days}
              onClick={() => void saveRetention(opt.days)}
              className="flex w-full items-center justify-between border-b border-gray-50 px-2 py-2 text-left text-[15px] last:border-0"
            >
              <span>{opt.label}</span>
              {defaultRetention === opt.days && (
                <span className="text-imsg-blue">✓</span>
              )}
            </button>
          ))}
        </div>
        <p className="mb-6 -mt-4 text-xs text-gray-400">
          Applies to every conversation that hasn’t set its own override.
          {retentionSaved && <span className="text-imsg-blue"> · Saved</span>}
        </p>

        <h2 className="mb-2 text-xs font-semibold uppercase text-gray-400">
          Create user
        </h2>
        <form onSubmit={createUser} className="mb-6 rounded-2xl bg-white p-4 shadow-sm">
          <input
            className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-[15px] outline-none focus:border-imsg-blue"
            placeholder="Username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-[15px] outline-none focus:border-imsg-blue"
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <input
            className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-[15px] outline-none focus:border-imsg-blue"
            placeholder="Initial password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <label className="mb-3 flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={makeAdmin}
              onChange={(e) => setMakeAdmin(e.target.checked)}
            />
            Grant administrator
          </label>
          {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-imsg-blue py-2 text-white disabled:opacity-50"
          >
            {busy ? "…" : "Create user"}
          </button>
          <p className="mt-2 text-xs text-gray-400">
            Share the username + password securely. They set up encryption keys on
            first sign-in.
          </p>
        </form>

        <h2 className="mb-2 text-xs font-semibold uppercase text-gray-400">
          {users.length} users
        </h2>
        <div className="rounded-2xl bg-white p-2 shadow-sm">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 border-b border-gray-50 px-2 py-2 last:border-0"
            >
              <Avatar name={u.display_name || u.username} size={36} />
              <div className="flex-1">
                <div className="text-[15px]">
                  {u.display_name || u.username}
                  {u.is_admin && (
                    <span className="ml-2 rounded bg-blue-50 px-1.5 text-xs text-imsg-blue">
                      admin
                    </span>
                  )}
                  {u.id === me.id && <span className="text-gray-400"> (You)</span>}
                </div>
                <div className="text-xs text-gray-400">@{u.username}</div>
              </div>
              {u.id !== me.id && (
                <div className="flex items-center gap-3">
                  <button className="text-sm text-imsg-blue" onClick={() => toggleAdmin(u)}>
                    {u.is_admin ? "Revoke" : "Make admin"}
                  </button>
                  <button className="text-sm text-red-500" onClick={() => remove(u)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
