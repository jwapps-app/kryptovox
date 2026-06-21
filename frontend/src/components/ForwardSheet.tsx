import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { conversationTitle } from "../lib/format";
import Avatar from "./Avatar";
import type { Conversation } from "../lib/types";

interface Props {
  onClose: () => void;
  onPick: (conversation: Conversation) => void;
}

// Pick a conversation to forward a message into.
export default function ForwardSheet({ onClose, onPick }: Props) {
  const user = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);

  return (
    <div
      className="fixed left-0 right-0 top-0 z-50 flex items-end bg-black/40"
      style={{ height: "var(--vh, 100dvh)" }}
      onClick={onClose}
    >
      <div
        className="max-h-full w-full overflow-y-auto rounded-t-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <span className="font-semibold">Forward to…</span>
          <button className="text-imsg-blue" onClick={onClose}>
            Cancel
          </button>
        </div>
        <ul>
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                onClick={() => onPick(c)}
              >
                <Avatar name={conversationTitle(c, user.id)} />
                <span className="truncate font-medium">
                  {conversationTitle(c, user.id)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
