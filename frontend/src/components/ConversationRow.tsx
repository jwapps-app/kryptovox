import { useRef, useState } from "react";
import Avatar from "./Avatar";
import { conversationTitle, relativeTime } from "../lib/format";
import type { Conversation } from "../lib/types";

const REVEAL = 84; // px of red "Delete" exposed by a full swipe

interface Props {
  conversation: Conversation;
  currentUserId: string;
  preview: string;
  onOpen: () => void;
  onDelete: () => void;
}

// A conversation list row. On touch, swipe left to reveal Delete; on devices
// with a mouse (no swipe), a trash button appears on hover (CSS-gated).
export default function ConversationRow({
  conversation: c,
  currentUserId,
  preview,
  onOpen,
  onDelete,
}: Props) {
  const title = conversationTitle(c, currentUserId);
  const [dx, setDx] = useState(0);
  const startX = useRef(0);
  const startDx = useRef(0);
  const moved = useRef(false);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startDx.current = dx;
    moved.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientX - startX.current;
    if (Math.abs(delta) > 8) moved.current = true;
    setDx(Math.max(-REVEAL, Math.min(0, startDx.current + delta)));
  };
  const onTouchEnd = () => setDx(dx < -REVEAL / 2 ? -REVEAL : 0);

  const onClickRow = () => {
    if (moved.current) {
      moved.current = false;
      return; // it was a swipe, not a tap
    }
    if (dx < 0) {
      setDx(0); // tapping an open row closes it
      return;
    }
    onOpen();
  };

  const snapped = dx === 0 || dx === -REVEAL;

  return (
    <li className="kv-row relative overflow-hidden">
      <button
        onClick={onDelete}
        aria-label="Delete conversation"
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500 text-sm font-medium text-white"
        style={{ width: REVEAL }}
      >
        Delete
      </button>

      <div
        className="relative z-10 bg-white"
        style={{
          transform: `translateX(${dx}px)`,
          transition: snapped ? "transform 0.2s ease" : "none",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
          onClick={onClickRow}
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

        <button
          onClick={() => {
            if (confirm("Delete this conversation?")) onDelete();
          }}
          aria-label="Delete conversation"
          className="kv-row-trash absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-gray-100 text-red-500 hover:bg-gray-200"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
      </div>
    </li>
  );
}
