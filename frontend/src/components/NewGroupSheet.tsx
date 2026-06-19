import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { userLabel } from "../lib/format";
import Avatar from "./Avatar";
import { useChat } from "../store/chat";
import type { Conversation, User } from "../lib/types";

export default function NewGroupSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [selected, setSelected] = useState<User[]>([]);
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const loadConversations = useChat((s) => s.loadConversations);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(async () => {
      const users = await api<User[]>(`/users/search?q=${encodeURIComponent(q.trim())}`);
      setResults(users.filter((u) => !selected.some((s) => s.id === u.id)));
    }, 200);
    return () => clearTimeout(t);
  }, [q, selected]);

  const create = async () => {
    const conv = await api<Conversation>("/conversations", {
      method: "POST",
      body: JSON.stringify({
        type: "group",
        name: name.trim() || "New Group",
        member_ids: selected.map((u) => u.id),
      }),
    });
    await loadConversations();
    onClose();
    navigate(`/chat/${conv.id}`);
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <button className="text-imsg-blue" onClick={onClose}>
          Cancel
        </button>
        <span className="font-semibold">New Group</span>
        <button
          className="text-imsg-blue disabled:opacity-40"
          disabled={selected.length < 1}
          onClick={create}
        >
          Create
        </button>
      </header>

      <div className="px-4 py-3">
        <input
          className="mb-3 w-full rounded-xl border border-gray-200 px-4 py-2 text-[17px] outline-none focus:border-imsg-blue"
          placeholder="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {selected.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {selected.map((u) => (
              <button
                key={u.id}
                className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-sm text-imsg-blue"
                onClick={() => setSelected((s) => s.filter((x) => x.id !== u.id))}
              >
                {userLabel(u)} ✕
              </button>
            ))}
          </div>
        )}
        <input
          className="w-full rounded-xl bg-gray-100 px-4 py-2 text-[17px] outline-none"
          placeholder="Search to add people"
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
              onClick={() => {
                setSelected((s) => [...s, u]);
                setQ("");
              }}
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
