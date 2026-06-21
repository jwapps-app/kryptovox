import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { encryptWithKey, generateThreadKey, wrapKeyForSelf } from "../crypto/guest";
import type { GuestThreadDetail } from "../lib/types";

const EXPIRY = [
  { key: "burn", label: "Burn · 10 min after open" },
  { key: "1", label: "1 day" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "0", label: "Never" },
];

export default function NewSecretLinkSheet({ onClose }: { onClose: () => void }) {
  const identity = useAuth((s) => s.identity);
  const user = useAuth((s) => s.user)!;
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState("7");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    const value = text.trim();
    if (!value || !identity || !user.identity_public_key || busy) return;
    setBusy(true);
    try {
      const { key, raw } = await generateThreadKey();
      const enc = await encryptWithKey(key, value);
      const wrapped_key = await wrapKeyForSelf(
        raw,
        identity.privateKey,
        user.identity_public_key
      );
      const labelEnc = label.trim() ? await encryptWithKey(key, label.trim()) : null;
      const burn = expiry === "burn";
      const thread = await api<GuestThreadDetail>("/links", {
        method: "POST",
        body: JSON.stringify({
          wrapped_key,
          expires_in_days: burn ? null : Number(expiry),
          burn_minutes: burn ? 10 : null,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          label_ciphertext: labelEnc?.ciphertext ?? null,
          label_iv: labelEnc?.iv ?? null,
        }),
      });
      setLink(`${window.location.origin}/g/${thread.id}#${raw}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const canShare = typeof navigator.share === "function";

  return (
    <div
      className="fixed left-0 right-0 top-0 z-50 flex items-end bg-black/40"
      style={{ height: "var(--vh, 100dvh)" }}
      onClick={onClose}
    >
      <div
        className="max-h-full w-full overflow-y-auto rounded-t-2xl bg-white p-4"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold">New secret link</span>
          <button className="text-imsg-blue" onClick={onClose}>
            {link ? "Done" : "Cancel"}
          </button>
        </div>

        {!link ? (
          <>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. “Sarah”) — only you see it"
              className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-[16px] outline-none focus:border-imsg-blue"
            />
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write an encrypted message…"
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-[16px] outline-none focus:border-imsg-blue"
            />
            <div className="mt-3 text-xs font-semibold uppercase text-gray-400">Expires</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {EXPIRY.map((e) => (
                <button
                  key={e.key}
                  onClick={() => setExpiry(e.key)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    expiry === e.key
                      ? "border-imsg-blue bg-blue-50 text-imsg-blue"
                      : "border-gray-200 text-gray-600"
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            {expiry === "burn" && (
              <p className="mt-1 text-xs text-gray-400">
                The 10-minute clock starts when they open it. It won't be deleted
                until you've read it.
              </p>
            )}
            <button
              disabled={!text.trim() || busy}
              onClick={() => void create()}
              className="mt-4 w-full rounded-xl bg-imsg-blue py-3 text-white disabled:opacity-50"
            >
              {busy ? "…" : "Create link"}
            </button>
            <p className="mt-2 text-center text-xs text-gray-400">
              Anyone with the link can read and reply. Share it over a trusted channel.
            </p>
          </>
        ) : (
          <>
            <div className="break-all rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
              {link}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void copy()}
                className="flex-1 rounded-xl bg-imsg-blue py-3 text-white"
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
              {canShare && (
                <button
                  onClick={() => void navigator.share({ url: link }).catch(() => {})}
                  className="flex-1 rounded-xl border border-gray-200 py-3 text-imsg-blue"
                >
                  Share
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-gray-400">
              The decryption key is in the link — the server never sees it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
