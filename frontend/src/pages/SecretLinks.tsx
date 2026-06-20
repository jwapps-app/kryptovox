import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { decryptWithKey, unwrapKeyForSelf } from "../crypto/guest";
import { relativeTime } from "../lib/format";
import BackButton from "../components/BackButton";
import NewSecretLinkSheet from "../components/NewSecretLinkSheet";
import type { GuestThreadSummary } from "../lib/types";

export default function SecretLinks() {
  const navigate = useNavigate();
  const identity = useAuth((s) => s.identity);
  const user = useAuth((s) => s.user)!;
  const guestReplyTick = useChat((s) => s.guestReplyTick);
  const [threads, setThreads] = useState<GuestThreadSummary[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    const list = await api<GuestThreadSummary[]>("/links").catch(() => []);
    setThreads(list);
    if (!identity || !user.identity_public_key) return;
    const pv: Record<string, string> = {};
    for (const t of list) {
      if (!t.last) continue;
      try {
        const key = await unwrapKeyForSelf(
          t.wrapped_key,
          identity.privateKey,
          user.identity_public_key
        );
        pv[t.id] = await decryptWithKey(key, t.last.ciphertext, t.last.iv);
      } catch {
        pv[t.id] = "…";
      }
    }
    setPreviews(pv);
  }, [identity, user.identity_public_key]);

  useEffect(() => {
    void load();
  }, [load, guestReplyTick]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <BackButton onClick={() => navigate("/settings")} />
        <span className="font-semibold">Secret links</span>
        <button className="ml-auto text-imsg-blue" onClick={() => setNewOpen(true)}>
          New
        </button>
      </header>

      <ul className="kv-scroll flex-1 overflow-y-auto">
        {threads.length === 0 && (
          <li className="px-6 py-10 text-center text-gray-400">
            No secret links yet.
            <br />
            Tap “New” to send an encrypted message to someone — no account needed
            on their end. They can reply, but only within your link.
          </li>
        )}
        {threads.map((t) => (
          <li key={t.id}>
            <button
              className="flex w-full items-center justify-between border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50"
              onClick={() => navigate(`/links/${t.id}`)}
            >
              <div className="min-w-0">
                <div className="truncate text-[15px]">{previews[t.id] ?? "…"}</div>
                <div className="text-xs text-gray-400">
                  {t.last?.sender === "guest" ? "↩ reply · " : ""}
                  {relativeTime(t.last_message_at)}
                  {t.expires_at
                    ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
              <span className="ml-2 text-gray-300">›</span>
            </button>
          </li>
        ))}
      </ul>

      {newOpen && (
        <NewSecretLinkSheet
          onClose={() => {
            setNewOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
