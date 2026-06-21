import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { decryptWithKey, encryptWithKey, importThreadKey } from "../crypto/guest";
import { useViewportHeight } from "../hooks/useViewportHeight";
import ExpiryBadge from "../components/ExpiryBadge";
import { clockTime } from "../lib/format";
import type { PublicThread } from "../lib/types";

interface Decoded {
  id: string;
  sender: "host" | "guest";
  text: string;
  created_at: string;
}

// Public page for a secret-link recipient — no account. The decryption key is in
// the URL fragment (never sent to the server).
export default function GuestView() {
  const { id = "" } = useParams();
  const keyB64 = window.location.hash.slice(1);
  const [error, setError] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Decoded[]>([]);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useViewportHeight();

  const load = useCallback(async () => {
    if (!keyRef.current) return;
    try {
      const res = await fetch(`/api/guest/${id}`);
      if (res.status === 410) return setError("This link has expired.");
      if (!res.ok) return setError("This link is invalid or was removed.");
      const thread = (await res.json()) as PublicThread;
      setExpiresAt(thread.expires_at);
      const out: Decoded[] = [];
      for (const m of thread.messages) {
        let t = "🔒";
        try {
          t = await decryptWithKey(keyRef.current, m.ciphertext, m.iv);
        } catch {
          t = "[unable to decrypt]";
        }
        out.push({ id: m.id, sender: m.sender, text: t, created_at: m.created_at });
      }
      setMsgs(out);
    } catch {
      /* transient network error — keep polling */
    }
  }, [id]);

  useEffect(() => {
    if (!keyB64) return setError("This link is missing its key.");
    let cancelled = false;
    let timer: number | undefined;
    void (async () => {
      try {
        keyRef.current = await importThreadKey(keyB64);
      } catch {
        return setError("This link's key is invalid.");
      }
      if (cancelled) return;
      await load();
      timer = window.setInterval(() => void load(), 5000);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [keyB64, load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  // Keep the latest message visible when the keyboard shrinks the view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const send = async () => {
    const value = text.trim();
    if (!value || !keyRef.current || sending) return;
    setSending(true);
    setText("");
    try {
      const enc = await encryptWithKey(keyRef.current, value);
      const res = await fetch(`/api/guest/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enc),
      });
      if (res.ok) await load();
      else setText(value);
    } catch {
      setText(value);
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-gray-500">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <span className="font-semibold">Secret message</span>
        {expiresAt ? (
          <ExpiryBadge expiresAt={expiresAt} className="ml-auto text-xs text-gray-400" />
        ) : (
          <span className="ml-auto text-xs text-gray-400">end-to-end encrypted</span>
        )}
      </header>

      <div ref={scrollRef} className="kv-scroll no-scrollbar flex-1 overflow-y-auto py-3">
        {msgs.map((m) => {
          const mine = m.sender === "guest";
          return (
            <div
              key={m.id}
              className={`mb-3 flex flex-col px-3 ${mine ? "items-end" : "items-start"}`}
            >
              <div
                className="max-w-[75%] whitespace-pre-wrap break-words px-3 py-2 text-[17px] leading-snug"
                style={{
                  background: mine ? "#007AFF" : "#E9E9EB",
                  color: mine ? "#ffffff" : "#000000",
                  borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                }}
              >
                {m.text}
              </div>
              <div className="mt-0.5 px-1 text-[11px] text-gray-400">
                {clockTime(m.created_at)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="kv-input-bar border-t border-gray-100">
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply…"
            autoCapitalize="sentences"
            autoCorrect="on"
            className="no-scrollbar max-h-[120px] flex-1 resize-none rounded-2xl border border-gray-200 px-4 py-2 text-[17px] outline-none focus:border-imsg-blue"
          />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            aria-label="Send"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: "#007AFF", opacity: text.trim() ? 1 : 0.3 }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
