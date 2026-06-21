import { useEffect, useRef, useState } from "react";
import { clockTime } from "../lib/format";
import { mapsUrl } from "../lib/prefs";
import type { Message } from "../lib/types";

export const TAPBACKS = ["❤️", "👍", "👎", "😂", "‼️", "❓"];

interface Props {
  message: Message;
  text: string;
  isMine: boolean;
  isLastInGroup: boolean;
  currentUserId: string;
  replyText: string | null;
  status: "sent" | "delivered" | "read" | null;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
  onUnsend: (id: string) => void;
  onEdit?: (message: Message) => void;
  onForward?: (message: Message) => void;
  thumbUrl?: string;
  onOpenImage?: (message: Message) => void;
}

export default function MessageBubble({
  message,
  text,
  isMine,
  isLastInGroup,
  currentUserId,
  replyText,
  status,
  onReact,
  onReply,
  onUnsend,
  onEdit,
  onForward,
  thumbUrl,
  onOpenImage,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss the tapback popup when tapping anywhere outside this bubble.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (message.deleted_at) {
    return (
      <div className={`flex ${isMine ? "justify-end" : "justify-start"} px-3`}>
        <div className="my-0.5 text-xs italic text-gray-400">Message Unsent</div>
      </div>
    );
  }

  // When the keyboard is up (an input is focused), tapping a message to react
  // would steal focus and dismiss it. Cancel the focus-steal in that case only,
  // so desktop text selection is unaffected when nothing is focused.
  const keepKeyboard = (e: React.MouseEvent) => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) {
      e.preventDefault();
    }
  };

  const radius = isMine ? "18px 18px 4px 18px" : "18px 18px 18px 4px";

  let location: { lat: number; lng: number; acc: number } | null = null;
  if (message.type === "location") {
    try {
      location = JSON.parse(text);
    } catch {
      /* unparseable — fall back to a plain label */
    }
  }
  const mapUrl = location ? mapsUrl(location.lat, location.lng) : "";

  // Aggregate reactions by emoji.
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const r of message.reactions) {
    const cur = counts.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === currentUserId) cur.mine = true;
    counts.set(r.emoji, cur);
  }

  return (
    <div
      ref={rootRef}
      className={`flex flex-col px-3 ${isMine ? "items-end" : "items-start"} ${
        isLastInGroup ? "mb-3" : "mb-1"
      }`}
    >
      {replyText !== null && (
        <div
          className={`mb-0.5 max-w-[70%] truncate rounded-xl px-3 py-1 text-xs text-gray-500 ${
            isMine ? "bg-gray-100" : "bg-gray-100"
          }`}
        >
          ↩ {replyText || "…"}
        </div>
      )}

      {message.type === "image" && message.media ? (
        <button
          onMouseDown={keepKeyboard}
          onClick={() => onOpenImage?.(message)}
          className="block overflow-hidden bg-gray-100"
          style={{ width: "min(72%, 250px)", borderRadius: radius }}
          aria-label="Open photo"
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt="Photo"
              className="block w-full"
              style={{ aspectRatio: `${message.media.w} / ${message.media.h}` }}
            />
          ) : (
            <div
              className="flex items-center justify-center text-sm text-gray-400"
              style={{ aspectRatio: `${message.media.w} / ${message.media.h}` }}
            >
              Loading…
            </div>
          )}
        </button>
      ) : message.type === "location" && location ? (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={keepKeyboard}
          className="block max-w-[78%] px-3 py-2.5"
          style={{
            background: isMine ? "#007AFF" : "var(--bubble-in-bg)",
            color: isMine ? "#ffffff" : "var(--bubble-in-text)",
            borderRadius: radius,
          }}
        >
          <div className="flex items-center gap-2.5">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div className="min-w-0">
              <div className="text-[15px] font-medium leading-tight">Shared location</div>
              <div className="text-xs opacity-80">
                ±{Math.round(location.acc)} m · Open in Maps
              </div>
            </div>
          </div>
        </a>
      ) : (
        <div
          onMouseDown={keepKeyboard}
          onClick={() => setOpen((v) => !v)}
          className="max-w-[75%] cursor-default whitespace-pre-wrap break-words px-3 py-2 text-[17px] leading-snug"
          style={{
            background: isMine ? "#007AFF" : "var(--bubble-in-bg)",
            color: isMine ? "#ffffff" : "var(--bubble-in-text)",
            borderRadius: radius,
          }}
        >
          {message.type === "location" ? "📍 Location" : text || "…"}
        </div>
      )}

      {message.edited_at && !message.deleted_at && (
        <div className="mt-0.5 px-1 text-[11px] text-gray-400">Edited</div>
      )}

      {/* Aggregated reaction pills */}
      {counts.size > 0 && (
        <div
          onMouseDown={keepKeyboard}
          className={`mt-0.5 flex gap-1 ${isMine ? "flex-row-reverse" : ""}`}
        >
          {[...counts.entries()].map(([emoji, { count, mine }]) => (
            <button
              key={emoji}
              onClick={() => onReact(message.id, emoji)}
              className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs ${
                mine ? "border-imsg-blue bg-blue-50" : "border-gray-200 bg-white"
              }`}
            >
              <span>{emoji}</span>
              {count > 1 && <span className="text-gray-500">{count}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Action row on tap */}
      {open && (
        <div
          onMouseDown={keepKeyboard}
          className="mt-1 flex max-w-[85vw] flex-wrap items-center justify-center gap-1 rounded-2xl bg-white px-2 py-1 shadow"
        >
          {TAPBACKS.map((emoji) => (
            <button
              key={emoji}
              className="text-lg"
              onClick={() => {
                onReact(message.id, emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
          {message.type === "text" && text && (
            <button
              className="ml-1 border-l border-gray-200 pl-2 text-xs text-imsg-blue"
              onClick={() => {
                navigator.clipboard?.writeText(text).catch(() => {});
                setOpen(false);
              }}
            >
              Copy
            </button>
          )}
          {onForward && (message.type === "text" || message.type === "location") && (
            <button
              className="ml-1 border-l border-gray-200 pl-2 text-xs text-imsg-blue"
              onClick={() => {
                onForward(message);
                setOpen(false);
              }}
            >
              Forward
            </button>
          )}
          <button
            className="ml-1 border-l border-gray-200 pl-2 text-xs text-imsg-blue"
            onClick={() => {
              onReply(message);
              setOpen(false);
            }}
          >
            Reply
          </button>
          {isMine && message.type === "text" && onEdit && (
            <button
              className="ml-1 border-l border-gray-200 pl-2 text-xs text-imsg-blue"
              onClick={() => {
                onEdit(message);
                setOpen(false);
              }}
            >
              Edit
            </button>
          )}
          {isMine && (
            <button
              className="pl-1 text-xs text-red-500"
              onClick={() => {
                if (confirm("Unsend this message?")) onUnsend(message.id);
                setOpen(false);
              }}
            >
              Unsend
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="mt-0.5 px-1 text-[11px] text-gray-400">
          {clockTime(message.created_at)}
        </div>
      )}

      {/* Delivery / read status under the last outgoing message */}
      {status && (
        <div className="mt-0.5 px-1 text-[11px] text-gray-400">
          {status === "read" ? "Read" : status === "delivered" ? "Delivered" : "Sent"}
        </div>
      )}
    </div>
  );
}
