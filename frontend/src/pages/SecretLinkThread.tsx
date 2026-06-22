import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import {
  decryptFileToUrl,
  decryptImageToUrl,
  decryptThumbToUrl,
  decryptWithKey,
  encryptFileWithKey,
  encryptImageWithKey,
  encryptWithKey,
  exportThreadKey,
  unwrapKeyForSelf,
} from "../crypto/guest";
import { fetchThreadMediaHost, uploadThreadMediaHost } from "../lib/media";
import BackButton from "../components/BackButton";
import ExpiryBadge from "../components/ExpiryBadge";
import GuestBubble from "../components/GuestBubble";
import type { Decoded, GuestThreadDetail } from "../lib/types";

export default function SecretLinkThread() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const identity = useAuth((s) => s.identity);
  const user = useAuth((s) => s.user)!;
  const guestReplyTick = useChat((s) => s.guestReplyTick);
  const keyRef = useRef<CryptoKey | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const thumbsRef = useRef<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
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
      if (m.type === "image" && m.media && !thumbsRef.current[m.id]) {
        try {
          thumbsRef.current[m.id] = await decryptThumbToUrl(
            m.media.thumb,
            m.media.thumb_iv,
            keyRef.current
          );
        } catch {
          /* skip */
        }
      }
    }
    setMsgs(out);
    setThumbs({ ...thumbsRef.current });
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

  const [locating, setLocating] = useState(false);

  const send = async () => {
    const value = text.trim();
    if (!value || !keyRef.current || sending) return;
    setSending(true);
    setText("");
    try {
      const enc = await encryptWithKey(keyRef.current, value);
      await api(`/links/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ type: "text", ...enc }),
      });
      await load();
    } catch {
      setText(value);
    } finally {
      setSending(false);
    }
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !keyRef.current) return;
    try {
      const { blob, media } = await encryptImageWithKey(file, keyRef.current);
      const mediaId = await uploadThreadMediaHost(id, blob);
      await api(`/links/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ type: "image", media: { ...media, id: mediaId } }),
      });
      await load();
    } catch {
      /* best-effort */
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !keyRef.current) return;
    try {
      const name = await encryptWithKey(keyRef.current, file.name);
      const f = await encryptFileWithKey(file, keyRef.current);
      const mediaId = await uploadThreadMediaHost(id, f.blob);
      await api(`/links/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          type: "file",
          ciphertext: name.ciphertext,
          iv: name.iv,
          file: { ...f.media, id: mediaId },
        }),
      });
      await load();
    } catch {
      /* best-effort */
    }
  };

  const openFile = async (m: Decoded) => {
    if (!m.media || !keyRef.current) return;
    try {
      const bytes = await fetchThreadMediaHost(id, m.media.id);
      const url = await decryptFileToUrl(bytes, m.media.iv, m.media.mime, keyRef.current);
      const a = document.createElement("a");
      a.href = url;
      a.download = m.text || "file";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      /* best-effort */
    }
  };

  const openImage = async (m: Decoded) => {
    if (!m.media || !keyRef.current) return;
    setViewerLoading(true);
    try {
      const bytes = await fetchThreadMediaHost(id, m.media.id);
      setViewerUrl(await decryptImageToUrl(bytes, m.media.iv, keyRef.current));
    } catch {
      /* ignore */
    } finally {
      setViewerLoading(false);
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
          await api(`/links/${id}/messages`, {
            method: "POST",
            body: JSON.stringify({ type: "location", ...enc }),
          });
          await load();
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
        {msgs.map((m) => (
          <GuestBubble
            key={m.id}
            msg={m}
            mine={m.sender === "host"}
            thumbUrl={thumbs[m.id]}
            onOpenImage={() => void openImage(m)}
            onOpenFile={() => void openFile(m)}
          />
        ))}
      </div>

      <div className="kv-input-bar border-t border-gray-100">
        <div className="flex items-end gap-2 px-3 py-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickImage}
          />
          <input ref={attachRef} type="file" className="hidden" onChange={onPickFile} />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => attachRef.current?.click()}
            aria-label="Attach file"
            title="Attach file"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-imsg-blue active:opacity-60"
          >
            <svg
              width="22"
              height="22"
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
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            aria-label="Send photo"
            title="Send photo"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-imsg-blue active:opacity-60"
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
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
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

      {(viewerLoading || viewerUrl) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => {
            if (viewerUrl) URL.revokeObjectURL(viewerUrl);
            setViewerUrl(null);
          }}
        >
          {viewerUrl ? (
            <img src={viewerUrl} alt="Photo" className="max-h-full max-w-full" />
          ) : (
            <span className="text-white">Loading…</span>
          )}
        </div>
      )}
    </div>
  );
}
