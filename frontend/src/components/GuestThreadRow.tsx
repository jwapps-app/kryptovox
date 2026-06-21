import { useRef, useState } from "react";
import { relativeTime } from "../lib/format";
import type { GuestThreadSummary } from "../lib/types";

const REVEAL = 84;

interface Props {
  thread: GuestThreadSummary;
  label: string;
  preview: string;
  onOpen: () => void;
  onDelete: () => void;
}

// A secret-link thread row in the main list. Marked with a link icon to set it
// apart from real identity-based chats. Swipe left (or hover) to delete/revoke.
export default function GuestThreadRow({ thread, label, preview, onOpen, onDelete }: Props) {
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
    const d = e.touches[0].clientX - startX.current;
    if (Math.abs(d) > 8) moved.current = true;
    setDx(Math.max(-REVEAL, Math.min(0, startDx.current + d)));
  };
  const onTouchEnd = () => setDx(dx < -REVEAL / 2 ? -REVEAL : 0);
  const onClick = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    if (dx !== 0) {
      setDx(0);
      return;
    }
    onOpen();
  };
  const snapped = dx === 0 || dx === -REVEAL;

  return (
    <li className="kv-row relative overflow-hidden">
      <button
        onClick={onDelete}
        aria-label="Delete secret link"
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
          onClick={onClick}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-imsg-blue">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between">
              <span className="truncate font-medium">{label}</span>
              <span className="ml-2 shrink-0 text-xs text-gray-400">
                {relativeTime(thread.last_message_at)}
              </span>
            </div>
            <div className="truncate text-sm text-gray-500">
              {thread.last?.sender === "guest" ? "↩ " : ""}
              {preview}
            </div>
          </div>
        </button>

        <div className="kv-row-actions absolute right-2 top-1/2 -translate-y-1/2 items-center gap-1">
          <button
            onClick={() => {
              if (confirm("Delete this secret link? The recipient will lose access."))
                onDelete();
            }}
            aria-label="Delete secret link"
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
