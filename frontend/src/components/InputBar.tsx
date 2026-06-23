import { useEffect, useRef, useState } from "react";
import { sendTyping } from "../hooks/useWebSocket";
import { getDraft, setDraft } from "../lib/drafts";
import { getPrefs } from "../lib/prefs";

interface Props {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
  onSendImage: (file: File) => Promise<void>;
  onSendFile: (file: File) => Promise<void>;
  onSendLocation: (coords: { lat: number; lng: number; acc: number }) => Promise<void>;
  replyPreview?: string | null;
  onCancelReply?: () => void;
  editing?: { id: string; text: string } | null;
  onSubmitEdit?: (text: string) => Promise<void>;
  onCancelEdit?: () => void;
}

export default function InputBar({
  conversationId,
  onSend,
  onSendImage,
  onSendFile,
  onSendLocation,
  replyPreview,
  onCancelReply,
  editing,
  onSubmitEdit,
  onCancelEdit,
}: Props) {
  const [text, setText] = useState(() => getDraft(conversationId));
  const [sending, setSending] = useState(false);
  const [locating, setLocating] = useState(false);

  // Load this conversation's draft when switching chats; persist on change.
  useEffect(() => {
    setText(getDraft(conversationId));
  }, [conversationId]);
  useEffect(() => {
    if (!editing) setDraft(conversationId, text); // editing text isn't a draft
  }, [conversationId, text, editing]);

  // Entering edit mode loads the message text; leaving restores the draft.
  useEffect(() => {
    setText(editing ? editing.text : getDraft(conversationId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const shareLocation = () => {
    if (!navigator.geolocation || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void onSendLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy,
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await onSendFile(file);
    } catch {
      /* best-effort */
    }
  };

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
    if (editing && onSubmitEdit) {
      setSending(true);
      try {
        await onSubmitEdit(value);
        // Restore the pre-edit draft so the edited text isn't left in the bar
        // (where it could be sent again as a new message).
        setText(getDraft(conversationId));
        onCancelEdit?.();
      } catch {
        /* keep the text so they can retry */
      } finally {
        setSending(false);
      }
      return;
    }
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
      {editing && (
        <div className="flex items-center justify-between bg-gray-50 px-4 py-1.5 text-sm text-gray-500">
          <span className="truncate">✎ Editing message</span>
          <button className="ml-2 text-imsg-blue" onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      )}
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
        onClick={shareLocation}
        disabled={locating}
        aria-label="Share location"
        className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center text-imsg-blue active:opacity-60 disabled:opacity-40"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={locating ? "animate-pulse" : ""}
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => attachRef.current?.click()}
        aria-label="Attach file"
        className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center text-imsg-blue active:opacity-60"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
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
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />
      <input ref={attachRef} type="file" hidden onChange={onPickFile} />
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
