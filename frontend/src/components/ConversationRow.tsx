import { useRef, useState } from "react";
import Avatar from "./Avatar";
import { conversationTitle, relativeTime } from "../lib/format";
import type { Conversation } from "../lib/types";

const REVEAL = 84; // px of action exposed by a full swipe

interface Props {
  conversation: Conversation;
  currentUserId: string;
  preview: string;
  onOpen: () => void;
  onDelete: () => void;
  onMarkUnread: () => void;
}

// A conversation list row. On touch: swipe left → Delete, swipe right → Unread.
// On devices with a mouse (no swipe), the same actions appear on hover.
export default function ConversationRow({
  conversation: c,
  currentUserId,
  preview,
  onOpen,
  onDelete,
  onMarkUnread,
}: Props) {
  const title = conversationTitle(c, currentUserId);
  const [dx, setDx] = useState(0);
  const startX = useRef(0);
  const startDx = useRef(0);
  const moved = useRef(false);

  const close = () => setDx(0);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startDx.current = dx;
    moved.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientX - startX.current;
    if (Math.abs(delta) > 8) moved.current = true;
    setDx(Math.max(-REVEAL, Math.min(REVEAL, startDx.current + delta)));
  };
  const onTouchEnd = () => {
    if (dx < -REVEAL / 2) setDx(-REVEAL);
    else if (dx > REVEAL / 2) setDx(REVEAL);
    else setDx(0);
  };

  const onClickRow = () => {
    if (moved.current) {
      moved.current = false;
      return; // it was a swipe, not a tap
    }
    if (dx !== 0) {
      close(); // tapping an open row closes it
      return;
    }
    onOpen();
  };

  const snapped = dx === 0 || dx === -REVEAL || dx === REVEAL;

  return (
    <li className="kv-row relative overflow-hidden">
      <button
        onClick={() => {
          onMarkUnread();
          close();
        }}
        aria-label="Mark unread"
        className="absolute inset-y-0 left-0 flex items-center justify-center bg-imsg-blue text-sm font-medium text-white"
        style={{ width: REVEAL }}
      >
        Unread
      </button>
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

        <div className="kv-row-actions absolute right-2 top-1/2 -translate-y-1/2 items-center gap-1">
          <button
            onClick={onMarkUnread}
            aria-label="Mark unread"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-imsg-blue hover:bg-gray-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="6" fill="currentColor" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (confirm("Delete this conversation?")) onDelete();
            }}
            aria-label="Delete conversation"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-red-500 hover:bg-gray-200"
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
      </div>
    </li>
  );
}
