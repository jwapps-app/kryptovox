import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { conversationTitle, userLabel } from "../lib/format";
import { safetyNumber } from "../lib/safety";
import Avatar from "../components/Avatar";
import BackButton from "../components/BackButton";
import type { Conversation, User } from "../lib/types";

const RETENTION_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: "Use default" },
  { days: 0, label: "Forever" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

function retentionLabel(days: number): string {
  if (days <= 0) return "Forever";
  if (days === 365) return "1 year";
  return `${days} days`;
}

export default function ChatInfo() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const setConvPrefs = useChat((s) => s.setConvPrefs);
  const clearHistory = useChat((s) => s.clearHistory);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [safety, setSafety] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [defaultRetention, setDefaultRetention] = useState(0);

  const load = () =>
    api<Conversation>(`/conversations/${id}`).then(setConv).catch(() => navigate("/"));

  useEffect(() => {
    void load();
    api<{ default_retention_days: number }>("/config")
      .then((c) => setDefaultRetention(c.default_retention_days))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Compute the safety number from every member's identity public key.
  useEffect(() => {
    if (!conv) return;
    const keys = conv.members
      .map((m) => m.identity_public_key)
      .filter((k): k is string => !!k);
    safetyNumber(keys).then(setSafety).catch(() => {});
  }, [conv]);

  if (!conv) return null;
  const isGroup = conv.type === "group";
  const isAdmin = conv.my_role === "admin";
  const title = conversationTitle(conv, user.id);

  const rename = async () => {
    const name = prompt("Group name", conv.name ?? "");
    if (!name) return;
    await api(`/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    void load();
  };

  const removeMember = async (uid: string) => {
    if (!confirm("Remove this member?")) return;
    await api(`/conversations/${id}/members/${uid}`, { method: "DELETE" });
    void load();
  };

  const leave = async () => {
    if (!confirm("Leave this group?")) return;
    await api(`/conversations/${id}/leave`, { method: "POST" });
    navigate("/");
  };

  const setRetention = async (days: number | null) => {
    const updated = await api<Conversation>(`/conversations/${id}/retention`, {
      method: "PATCH",
      body: JSON.stringify({ retention_days: days }),
    });
    setConv(updated);
  };

  const togglePref = async (key: "pinned" | "muted") => {
    if (!conv) return;
    const next = !conv[key];
    setConv({ ...conv, [key]: next });
    await setConvPrefs(id, { [key]: next });
  };

  const clear = async () => {
    if (
      !confirm(
        "Clear this conversation's history on your devices? The other person keeps their copy."
      )
    )
      return;
    await clearHistory(id);
    navigate(`/chat/${id}`);
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <BackButton onClick={() => navigate(`/chat/${id}`)} />
        <span className="font-semibold">{isGroup ? "Group Info" : "Contact Info"}</span>
        {isGroup && isAdmin && (
          <button className="ml-auto text-sm text-imsg-blue" onClick={rename}>
            Rename
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-6 flex flex-col items-center">
          <Avatar name={title} size={72} />
          <div className="mt-2 text-lg font-semibold">{title}</div>
        </div>

        <h2 className="mb-2 text-xs font-semibold uppercase text-gray-400">
          {isGroup ? `${conv.members.length} members` : "Members"}
        </h2>
        <div className="rounded-2xl bg-white p-2 shadow-sm">
          {conv.members.map((m: User) => (
            <div
              key={m.id}
              className="flex items-center gap-3 border-b border-gray-50 px-2 py-2 last:border-0"
            >
              <Avatar name={userLabel(m)} size={36} />
              <div className="flex-1">
                <div className="text-[15px]">
                  {userLabel(m)}
                  {m.id === user.id && <span className="text-gray-400"> (You)</span>}
                </div>
                <div className="text-xs text-gray-400">@{m.username}</div>
              </div>
              {isGroup && isAdmin && m.id !== user.id && (
                <button
                  className="text-sm text-red-500"
                  onClick={() => removeMember(m.id)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        {isGroup && isAdmin && (
          <button
            className="mt-3 w-full rounded-xl border border-gray-200 py-2 text-imsg-blue"
            onClick={() => setAddOpen(true)}
          >
            + Add member
          </button>
        )}

        <h2 className="mb-2 mt-6 text-xs font-semibold uppercase text-gray-400">
          Conversation
        </h2>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between py-1">
            <span className="text-[15px]">Pin to top</span>
            <Switch on={conv.pinned} onClick={() => void togglePref("pinned")} />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-[15px]">Mute notifications</span>
            <Switch on={conv.muted} onClick={() => void togglePref("muted")} />
          </div>
          <button
            className="mt-1 w-full py-1 text-left text-[15px] text-red-500"
            onClick={() => void clear()}
          >
            Clear history
          </button>
        </div>

        {/* Safety number — compare out-of-band to verify no key was swapped. */}
        <h2 className="mb-2 mt-6 text-xs font-semibold uppercase text-gray-400">
          Safety number
        </h2>
        <div className="rounded-2xl bg-white p-4 font-mono text-sm tracking-wide shadow-sm">
          {safety ?? "…"}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          If this matches on both devices, your conversation keys are verified.
        </p>

        {/* Message retention — shared by everyone in the conversation. */}
        <h2 className="mb-2 mt-6 text-xs font-semibold uppercase text-gray-400">
          Keep history
        </h2>
        <div className="rounded-2xl bg-white p-2 shadow-sm">
          {RETENTION_OPTIONS.map((opt) => (
            <button
              key={opt.days ?? "default"}
              onClick={() => void setRetention(opt.days)}
              className="flex w-full items-center justify-between border-b border-gray-50 px-2 py-2 text-left text-[15px] last:border-0"
            >
              <span>
                {opt.label}
                {opt.days === null && (
                  <span className="text-gray-400">
                    {" "}
                    ({retentionLabel(defaultRetention)})
                  </span>
                )}
              </span>
              {(conv.retention_days ?? null) === opt.days && (
                <span className="text-imsg-blue">✓</span>
              )}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Messages older than this are permanently deleted from the server, for
          everyone in this conversation. “Use default” follows the server-wide
          setting.
        </p>

        {isGroup && (
          <button
            className="mt-6 w-full rounded-xl border border-gray-200 py-3 text-red-500"
            onClick={leave}
          >
            Leave group
          </button>
        )}
      </div>

      {addOpen && (
        <AddMemberSheet
          conversationId={id}
          existing={conv.members.map((m) => m.id)}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-7 w-12 shrink-0 items-center rounded-full px-0.5 transition-colors ${
        on ? "justify-end" : "justify-start"
      }`}
      style={{ background: on ? "#34C759" : "#E9E9EB" }}
    >
      <span className="h-6 w-6 rounded-full bg-white shadow" />
    </button>
  );
}

function AddMemberSheet({
  conversationId,
  existing,
  onClose,
  onAdded,
}: {
  conversationId: string;
  existing: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<User[]>([]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(async () => {
      const users = await api<User[]>(`/users/search?q=${encodeURIComponent(q.trim())}`);
      setResults(users.filter((u) => !existing.includes(u.id)));
    }, 200);
    return () => clearTimeout(t);
  }, [q, existing]);

  const add = async (uid: string) => {
    await api(`/conversations/${conversationId}/members?user_id=${uid}`, {
      method: "POST",
    });
    onAdded();
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white">
      <header className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <button className="text-imsg-blue" onClick={onClose}>
          Cancel
        </button>
        <span className="font-semibold">Add member</span>
      </header>
      <div className="px-4 py-3">
        <input
          autoFocus
          className="w-full rounded-xl bg-gray-100 px-4 py-2 text-[17px] outline-none"
          placeholder="Search by username"
          autoCapitalize="none"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ul className="flex-1 overflow-y-auto">
        {results.map((u) => (
          <li key={u.id}>
            <button
              className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
              onClick={() => add(u.id)}
            >
              <Avatar name={userLabel(u)} size={36} />
              <span>{userLabel(u)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
