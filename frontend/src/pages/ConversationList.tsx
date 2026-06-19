import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { conversationTitle, relativeTime } from "../lib/format";
import Avatar from "../components/Avatar";
import NewMessageSheet from "../components/NewMessageSheet";
import NewGroupSheet from "../components/NewGroupSheet";
import { enablePush, pushPermission, pushSupported } from "../lib/push";

export default function ConversationList() {
  const user = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const textByMessage = useChat((s) => s.textByMessage);
  const loadConversations = useChat((s) => s.loadConversations);
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPushBanner, setShowPushBanner] = useState(
    pushSupported() && pushPermission() === "default"
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const onEnablePush = async () => {
    await enablePush().catch(() => {});
    setShowPushBanner(false);
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="relative flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <button
          className="text-xl text-gray-400"
          aria-label="Settings"
          onClick={() => navigate("/settings")}
        >
          ⚙
        </button>
        <h1 className="text-lg font-semibold">Messages</h1>
        <button
          className="text-2xl leading-none text-imsg-blue"
          aria-label="New"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ✎
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

      {showPushBanner && (
        <div className="flex items-center justify-between gap-2 bg-blue-50 px-4 py-2 text-sm">
          <span className="text-gray-600">Get notified of new messages</span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-full bg-imsg-blue px-3 py-1 text-white"
              onClick={onEnablePush}
            >
              Enable
            </button>
            <button className="text-gray-400" onClick={() => setShowPushBanner(false)}>
              ✕
            </button>
          </div>
        </div>
      )}

      <ul className="flex-1 overflow-y-auto">
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
            ? textByMessage[c.last_message.id] ?? "…"
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
