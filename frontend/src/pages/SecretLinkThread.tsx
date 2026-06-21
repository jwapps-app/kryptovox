import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import {
  decryptWithKey,
  encryptWithKey,
  exportThreadKey,
  unwrapKeyForSelf,
} from "../crypto/guest";
import { clockTime } from "../lib/format";
import BackButton from "../components/BackButton";
import ExpiryBadge from "../components/ExpiryBadge";
import type { GuestThreadDetail } from "../lib/types";

interface Decoded {
  id: string;
  sender: "host" | "guest";
  text: string;
  created_at: string;
}

export default function SecretLinkThread() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const identity = useAuth((s) => s.identity);
  const user = useAuth((s) => s.user)!;
  const guestReplyTick = useChat((s) => s.guestReplyTick);
  const keyRef = useRef<CryptoKey | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [msgs, setMsgs] = useState<Decoded[]>([]);
  const [label, setLabel] = useState("Secret link");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [burnMinutes, setBurnMinutes] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!identity || !user.identity_public_key) return;
    const detail = await api<GuestThreadDetail>(`/links/${id}`).catch(() => null);
    if (!detail) {
      navigate("/");
      return;
    }
    setExpiresAt(detail.expires_at);
    setBurnMinutes(detail.burn_minutes);
    if (!keyRef.current) {
      try {
        keyRef.current = await unwrapKeyForSelf(
          detail.wrapped_key,
          identity.privateKey,
          user.identity_public_key
        );
      } catch {
        return;
      }
    }
    if (detail.label_ciphertext && detail.label_iv) {
      try {
        setLabel(await decryptWithKey(keyRef.current, detail.label_ciphertext, detail.label_iv));
      } catch {
        /* keep default */
      }
    }
    const out: Decoded[] = [];
    for (const m of detail.messages) {
      let t = "🔒";
      try {
        t = await decryptWithKey(keyRef.current, m.ciphertext, m.iv);
      } catch {
        t = "[unable to decrypt]";
      }
      out.push({ id: m.id, sender: m.sender, text: t, created_at: m.created_at });
    }
    setMsgs(out);
  }, [id, identity, user.identity_public_key, navigate]);

  const loadGuestUnread = useChat((s) => s.loadGuestUnread);
  useEffect(() => {
    // Opening the thread marks it read server-side; refresh the badge.
    void load().then(() => loadGuestUnread());
  }, [load, guestReplyTick, loadGuestUnread]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const send = async () => {
    const value = text.trim();
    if (!value || !keyRef.current || sending) return;
    setSending(true);
    setText("");
    try {
      const enc = await encryptWithKey(keyRef.current, value);
      await api(`/links/${id}/messages`, { method: "POST", body: JSON.stringify(enc) });
      await load();
    } catch {
      setText(value);
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    if (!keyRef.current) return;
    const raw = await exportThreadKey(keyRef.current);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/g/${id}#${raw}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const revoke = async () => {
    if (!confirm("Delete this secret link? The recipient will lose access.")) return;
    await api(`/links/${id}`, { method: "DELETE" }).catch(() => {});
    navigate("/links");
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <BackButton onClick={() => navigate("/")} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-tight">{label}</div>
          <ExpiryBadge
            expiresAt={expiresAt}
            burnMinutes={burnMinutes}
            className="text-xs text-gray-400"
          />
        </div>
        <button className="text-sm text-imsg-blue" onClick={() => void copyLink()}>
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <button className="text-sm text-red-500" onClick={() => void revoke()}>
          Revoke
        </button>
      </header>

      <div ref={scrollRef} className="kv-scroll no-scrollbar flex-1 overflow-y-auto py-3">
        {msgs.map((m) => {
          const mine = m.sender === "host";
          return (
            <div
              key={m.id}
              className={`mb-3 flex flex-col px-3 ${mine ? "items-end" : "items-start"}`}
            >
              <div
                className="max-w-[75%] whitespace-pre-wrap break-words px-3 py-2 text-[17px] leading-snug"
                style={{
                  background: mine ? "#007AFF" : "var(--bubble-in-bg)",
                  color: mine ? "#ffffff" : "var(--bubble-in-text)",
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
            placeholder="Message…"
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
