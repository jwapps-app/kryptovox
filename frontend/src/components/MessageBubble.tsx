import { useEffect, useRef, useState } from "react";
import { clockTime } from "../lib/format";
import { mapsUrl } from "../lib/prefs";
import type { Message } from "../lib/types";

export const TAPBACKS = ["❤️", "👍", "👎", "😂", "‼️", "❓"];

// Feather/Lucide-style stroked icons, matching the gear/compose/location icons.
const iconProps: React.SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};
const IconCopy = () => (
  <svg {...iconProps}>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);
const IconPencil = () => (
  <svg {...iconProps}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);
const IconForward = () => (
  <svg {...iconProps}>
    <polyline points="15 17 20 12 15 7" />
    <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
  </svg>
);
const IconReply = () => (
  <svg {...iconProps}>
    <polyline points="9 17 4 12 9 7" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </svg>
);
const IconTrash = () => (
  <svg {...iconProps}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

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

      {/* Action menu on tap: emoji tapbacks on the left, actions stacked right. */}
      {open && (
        <div
          onMouseDown={keepKeyboard}
          className="mt-1 flex items-stretch gap-2 rounded-2xl bg-white px-2.5 py-2 shadow"
        >
          <div className="flex items-center gap-1.5">
            {TAPBACKS.map((emoji) => (
              <button
                key={emoji}
                className="text-xl leading-none"
                onClick={() => {
                  onReact(message.id, emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          {(() => {
            const showCopy = message.type === "text" && !!text;
            const showEdit = isMine && message.type === "text" && !!onEdit;
            const showForward =
              !!onForward && (message.type === "text" || message.type === "location");
            const btn = "p-0.5 text-imsg-blue active:opacity-60";
            return (
              <div className="flex flex-col gap-2 self-center border-l border-gray-200 pl-2.5">
                <div className="flex gap-3.5">
                  {(showCopy || showEdit) && (
                    <div className="flex flex-col items-center gap-2.5">
                      {showCopy && (
                        <button
                          className={btn}
                          aria-label="Copy"
                          title="Copy"
                          onClick={() => {
                            navigator.clipboard?.writeText(text).catch(() => {});
                            setOpen(false);
                          }}
                        >
                          <IconCopy />
                        </button>
                      )}
                      {showEdit && (
                        <button
                          className={btn}
                          aria-label="Edit"
                          title="Edit"
                          onClick={() => {
                            onEdit!(message);
                            setOpen(false);
                          }}
                        >
                          <IconPencil />
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col items-center gap-2.5">
                    {showForward && (
                      <button
                        className={btn}
                        aria-label="Forward"
                        title="Forward"
                        onClick={() => {
                          onForward!(message);
                          setOpen(false);
                        }}
                      >
                        <IconForward />
                      </button>
                    )}
                    <button
                      className={btn}
                      aria-label="Reply"
                      title="Reply"
                      onClick={() => {
                        onReply(message);
                        setOpen(false);
                      }}
                    >
                      <IconReply />
                    </button>
                  </div>
                </div>
                {isMine && (
                  <button
                    className="flex justify-center border-t border-gray-100 pt-1.5 text-red-500 active:opacity-60"
                    aria-label="Unsend"
                    title="Unsend"
                    onClick={() => {
                      if (confirm("Unsend this message?")) onUnsend(message.id);
                      setOpen(false);
                    }}
                  >
                    <IconTrash />
                  </button>
                )}
              </div>
            );
          })()}
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
