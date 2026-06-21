import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { decryptWithKey, encryptWithKey, importThreadKey } from "../crypto/guest";
import { useViewportHeight } from "../hooks/useViewportHeight";
import ExpiryBadge from "../components/ExpiryBadge";
import GuestBubble from "../components/GuestBubble";
import type { Decoded, PublicThread } from "../lib/types";

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
  const taRef = useRef<HTMLTextAreaElement>(null);

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
        let t = "";
        if (m.ciphertext) {
          try {
            t = await decryptWithKey(keyRef.current, m.ciphertext, m.iv);
          } catch {
            t = "[unable to decrypt]";
          }
        }
        out.push({
          id: m.id,
          sender: m.sender,
          type: m.type,
          text: t,
          media: m.media,
          created_at: m.created_at,
        });
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

  const [locating, setLocating] = useState(false);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/guest/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("send failed");
    await load();
  };

  const send = async () => {
    const value = text.trim();
    if (!value || !keyRef.current || sending) return;
    setSending(true);
    setText("");
    taRef.current?.focus(); // keep the keyboard up after sending
    try {
      const enc = await encryptWithKey(keyRef.current, value);
      await post({ type: "text", ciphertext: enc.ciphertext, iv: enc.iv });
    } catch {
      setText(value);
    } finally {
      setSending(false);
    }
  };

  const shareLocation = () => {
    if (!navigator.geolocation || !keyRef.current || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const payload = JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy,
          });
          const enc = await encryptWithKey(keyRef.current!, payload);
          await post({ type: "location", ciphertext: enc.ciphertext, iv: enc.iv });
        } catch {
          /* best-effort */
        } finally {
          setLocating(false);
        }
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
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
        <span className="ml-auto text-xs text-gray-400">end-to-end encrypted</span>
      </header>

      {expiresAt && (
        <div className="flex items-center justify-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0 animate-pulse"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            This message self-destructs in{" "}
            <ExpiryBadge expiresAt={expiresAt} bare className="font-semibold" />
          </span>
        </div>
      )}

      <div ref={scrollRef} className="kv-scroll no-scrollbar flex-1 overflow-y-auto py-3">
        {msgs.map((m) => (
          <GuestBubble key={m.id} msg={m} mine={m.sender === "guest"} />
        ))}
      </div>

      <div className="kv-input-bar border-t border-gray-100">
        <div className="flex items-end gap-2 px-3 py-2">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={shareLocation}
            disabled={locating}
            aria-label="Share location"
            title="Share location"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-imsg-blue active:opacity-60 disabled:opacity-40"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </button>
          <textarea
            ref={taRef}
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
