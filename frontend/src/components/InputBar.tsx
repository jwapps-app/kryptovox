import { useRef, useState } from "react";
import { sendTyping } from "../hooks/useWebSocket";
import { getPrefs } from "../lib/prefs";

interface Props {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
  onSendImage: (file: File) => Promise<void>;
  replyPreview?: string | null;
  onCancelReply?: () => void;
}

export default function InputBar({
  conversationId,
  onSend,
  onSendImage,
  replyPreview,
  onCancelReply,
}: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    try {
      await onSendImage(file);
    } catch {
      /* best-effort; failures are non-fatal */
    }
  };

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
    if (taRef.current) {
      taRef.current.style.height = "auto";
      taRef.current.focus(); // keep the keyboard up after sending
    }
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
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        aria-label="Add photo"
        className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center text-imsg-blue active:opacity-60"
      >
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
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onPickImage}
      />
      <textarea
        ref={taRef}
        rows={1}
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck={true}
        enterKeyHint="send"
        inputMode="text"
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
        // Don't let the button steal focus from the textarea — otherwise iOS
        // dismisses the keyboard on every send.
        onMouseDown={(e) => e.preventDefault()}
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
