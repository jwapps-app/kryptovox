import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { conversationTitle } from "../lib/format";
import Avatar from "./Avatar";

// Spotlight-style conversation switcher (Cmd/Ctrl+K).
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const user = useAuth((s) => s.user);
  const conversations = useChat((s) => s.conversations);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQ("");
        setCursor(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open || !user) return null;

  const filtered = conversations.filter((c) =>
    conversationTitle(c, user.id).toLowerCase().includes(q.toLowerCase())
  );

  const go = (index: number) => {
    const c = filtered[index];
    if (c) {
      navigate(`/chat/${c.id}`);
      setOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full border-b border-gray-100 px-4 py-3 text-[17px] outline-none"
          placeholder="Jump to conversation…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, filtered.length - 1));
            else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
            else if (e.key === "Enter") go(cursor);
          }}
        />
        <ul className="max-h-72 overflow-y-auto">
          {filtered.map((c, i) => {
            const title = conversationTitle(c, user.id);
            return (
              <li key={c.id}>
                <button
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                    i === cursor ? "bg-gray-100" : ""
                  }`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(i)}
                >
                  <Avatar name={title} size={32} />
                  <span>{title}</span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
