import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { userLabel } from "../lib/format";
import Avatar from "./Avatar";
import { useChat } from "../store/chat";
import type { Conversation, User } from "../lib/types";
import { useDialog } from "../hooks/useDialog";

export default function NewMessageSheet({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useDialog(rootRef, onClose);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const navigate = useNavigate();
  const loadConversations = useChat((s) => s.loadConversations);

  useEffect(() => {
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    let alive = true; // ignore a slow response for a query we've since replaced
    const t = setTimeout(async () => {
      try {
        const users = await api<User[]>(`/users/search?q=${encodeURIComponent(q.trim())}`);
        if (alive) setResults(users);
      } catch {
        if (alive) setResults([]);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const startChat = async (user: User) => {
    const conv = await api<Conversation>("/conversations", {
      method: "POST",
      body: JSON.stringify({ type: "direct", name: null, member_ids: [user.id] }),
    });
    await loadConversations();
    onClose();
    navigate(`/chat/${conv.id}`);
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="New message"
      className="fixed inset-0 z-20 flex flex-col bg-white"
    >
      <header className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <button className="text-imsg-blue" onClick={onClose}>
          Cancel
        </button>
        <span className="font-semibold">New Message</span>
      </header>
      <div className="px-4 py-3">
        <input
          autoFocus
          className="w-full rounded-xl bg-gray-100 px-4 py-2 text-[17px] outline-hidden"
          aria-label="Search by username"
          placeholder="Search by username"
          autoCapitalize="none"
          autoCorrect="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ul className="flex-1 overflow-y-auto">
        {results.map((u) => (
          <li key={u.id}>
            <button
              className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
              onClick={() => startChat(u)}
            >
              <Avatar name={userLabel(u)} userId={u.id} hasAvatar={u.has_avatar} />
              <div>
                <div className="text-[17px]">{userLabel(u)}</div>
                <div className="text-sm text-gray-500">@{u.username}</div>
              </div>
            </button>
          </li>
        ))}
        {q.trim() && results.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-400">No users found</li>
        )}
      </ul>
    </div>
  );
}
