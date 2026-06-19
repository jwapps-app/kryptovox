import { useState } from "react";
import { clockTime } from "../lib/format";
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
}: Props) {
  const [open, setOpen] = useState(false);

  if (message.deleted_at) {
    return (
      <div className={`flex ${isMine ? "justify-end" : "justify-start"} px-3`}>
        <div className="my-0.5 text-xs italic text-gray-400">Message Unsent</div>
      </div>
    );
  }

  const radius = isMine ? "18px 18px 4px 18px" : "18px 18px 18px 4px";

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

      <div
        onClick={() => setOpen((v) => !v)}
        className="max-w-[75%] cursor-default whitespace-pre-wrap break-words px-3 py-2 text-[17px] leading-snug"
        style={{
          background: isMine ? "#007AFF" : "#E9E9EB",
          color: isMine ? "#ffffff" : "#000000",
          borderRadius: radius,
        }}
      >
        {text || "…"}
      </div>

      {/* Aggregated reaction pills */}
      {counts.size > 0 && (
        <div className={`mt-0.5 flex gap-1 ${isMine ? "flex-row-reverse" : ""}`}>
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
        <div className="mt-1 flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow">
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
          <button
            className="ml-1 border-l border-gray-200 pl-2 text-xs text-imsg-blue"
            onClick={() => {
              onReply(message);
              setOpen(false);
            }}
          >
            Reply
          </button>
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
