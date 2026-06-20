import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { conversationTitle, relativeTime } from "../lib/format";
import Avatar from "../components/Avatar";
import NewMessageSheet from "../components/NewMessageSheet";
import NewGroupSheet from "../components/NewGroupSheet";

export default function ConversationList() {
  const user = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const textByMessage = useChat((s) => s.textByMessage);
  const loadConversations = useChat((s) => s.loadConversations);
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="relative flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <button
          className="text-imsg-blue active:opacity-60"
          aria-label="Settings"
          onClick={() => navigate("/settings")}
        >
          <svg
            width="25"
            height="25"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold">Messages</h1>
        <button
          className="text-imsg-blue active:opacity-60"
          aria-label="New"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <svg
            width="25"
            height="25"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-3 top-12 z-10 w-44 overflow-hidden rounded-xl bg-white shadow-lg">
            <button
              className="block w-full px-4 py-2 text-left hover:bg-gray-50"
              onClick={() => {
                setMenuOpen(false);
                setSheetOpen(true);
              }}
            >
              New Message
            </button>
            <button
              className="block w-full border-t border-gray-100 px-4 py-2 text-left hover:bg-gray-50"
              onClick={() => {
                setMenuOpen(false);
                setGroupOpen(true);
              }}
            >
              New Group
            </button>
          </div>
        )}
      </header>

      <ul className="kv-scroll flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <li className="px-4 py-10 text-center text-gray-400">
            No conversations yet.
            <br />
            Tap ✎ to start one.
          </li>
        )}
        {conversations.map((c) => {
          const title = conversationTitle(c, user.id);
          const preview = c.last_message
            ? c.last_message.type === "image"
              ? "📷 Photo"
              : textByMessage[c.last_message.id] ?? "…"
            : "No messages yet";
          return (
            <li key={c.id}>
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                onClick={() => navigate(`/chat/${c.id}`)}
              >
                <Avatar name={title} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="truncate font-medium">{title}</span>
                    {c.last_message && (
                      <span className="ml-2 shrink-0 text-xs text-gray-400">
                        {relativeTime(c.last_message.created_at)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm text-gray-500">
                      {c.last_message?.deleted_at ? "Message unsent" : preview}
                    </span>
                    {c.unread_count > 0 && (
                      <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-imsg-blue px-1.5 text-xs text-white">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {sheetOpen && <NewMessageSheet onClose={() => setSheetOpen(false)} />}
      {groupOpen && <NewGroupSheet onClose={() => setGroupOpen(false)} />}
    </div>
  );
}
