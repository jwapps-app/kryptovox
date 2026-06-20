import { useRef, useState } from "react";
import { sendTyping } from "../hooks/useWebSocket";
import { getPrefs } from "../lib/prefs";

interface Props {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
  replyPreview?: string | null;
  onCancelReply?: () => void;
}

export default function InputBar({
  conversationId,
  onSend,
  replyPreview,
  onCancelReply,
}: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  const signalTyping = () => {
    if (!getPrefs().typingIndicators) return;
    sendTyping(conversationId, true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      sendTyping(conversationId, false);
    }, 2000);
  };

  const submit = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
    sendTyping(conversationId, false);
    try {
      await onSend(value);
    } catch {
      setText(value); // restore on failure
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div id="kv-inputbar" className="kv-input-bar border-t border-gray-100">
      {replyPreview != null && (
        <div className="flex items-center justify-between bg-gray-50 px-4 py-1.5 text-sm text-gray-500">
          <span className="truncate">↩ Replying to: {replyPreview || "…"}</span>
          <button className="ml-2 text-imsg-blue" onClick={onCancelReply}>
            ✕
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
      <textarea
        ref={taRef}
        rows={1}
        className="no-scrollbar max-h-[120px] flex-1 resize-none rounded-2xl border border-gray-200 px-4 py-2 text-[17px] outline-none focus:border-imsg-blue"
        placeholder="Message"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          autoGrow();
          signalTyping();
        }}
        onKeyDown={onKeyDown}
      />
      <button
        onClick={() => void submit()}
        disabled={!hasText || sending}
        aria-label="Send"
        className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity"
        style={{ background: "#007AFF", opacity: hasText ? 1 : 0.3 }}
      >
        ↑
      </button>
      </div>
    </div>
  );
}
