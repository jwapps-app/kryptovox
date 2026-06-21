import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import {
  decryptWithKey,
  encryptWithKey,
  generateThreadKey,
  unwrapKeyForSelf,
  wrapKeyForSelf,
} from "../crypto/guest";
import BackButton from "../components/BackButton";
import type { Note } from "../lib/types";

export default function NoteEditor() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const identity = useAuth((s) => s.identity);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [loaded, setLoaded] = useState(false);

  const keyRef = useRef<CryptoKey | null>(null);
  const rawRef = useRef<string | null>(null); // raw key, for the first wrap-to-self
  const noteIdRef = useRef<string | null>(id === "new" ? null : id);
  const dirtyRef = useRef(false);

  // Load (or mint a key for) the note.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!identity || !user.identity_public_key) return;
      if (id === "new") {
        const { key, raw } = await generateThreadKey();
        keyRef.current = key;
        rawRef.current = raw;
        if (alive) setLoaded(true);
        return;
      }
      try {
        const n = await api<Note>(`/notes/${id}`);
        const key = await unwrapKeyForSelf(
          n.wrapped_key,
          identity.privateKey,
          user.identity_public_key
        );
        keyRef.current = key;
        const t = n.title_ciphertext
          ? await decryptWithKey(key, n.title_ciphertext, n.title_iv)
          : "";
        const b = n.body_ciphertext
          ? await decryptWithKey(key, n.body_ciphertext, n.body_iv)
          : "";
        if (!alive) return;
        setTitle(t);
        setBody(b);
        setLoaded(true);
      } catch {
        navigate("/notes");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = useCallback(async () => {
    const key = keyRef.current;
    if (!key || !identity || !user.identity_public_key) return;
    if (!noteIdRef.current && !title.trim() && !body.trim()) return; // nothing to create
    setStatus("saving");
    const t = await encryptWithKey(key, title);
    const b = await encryptWithKey(key, body);
    try {
      if (!noteIdRef.current) {
        const wrapped = await wrapKeyForSelf(
          rawRef.current!,
          identity.privateKey,
          user.identity_public_key
        );
        const created = await api<Note>("/notes", {
          method: "POST",
          body: JSON.stringify({
            wrapped_key: wrapped,
            title_ciphertext: t.ciphertext,
            title_iv: t.iv,
            body_ciphertext: b.ciphertext,
            body_iv: b.iv,
          }),
        });
        noteIdRef.current = created.id;
        // Update the URL without remounting (so Back returns to the list).
        window.history.replaceState(null, "", `/notes/${created.id}`);
      } else {
        await api(`/notes/${noteIdRef.current}`, {
          method: "PATCH",
          body: JSON.stringify({
            title_ciphertext: t.ciphertext,
            title_iv: t.iv,
            body_ciphertext: b.ciphertext,
            body_iv: b.iv,
          }),
        });
      }
      dirtyRef.current = false;
      setStatus("saved");
    } catch {
      setStatus("idle");
    }
  }, [title, body, identity, user.identity_public_key]);

  // Debounced autosave while editing.
  useEffect(() => {
    if (!loaded || !dirtyRef.current) return;
    const t = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(t);
  }, [title, body, loaded, save]);

  const edit = (fn: () => void) => {
    dirtyRef.current = true;
    setStatus("idle");
    fn();
  };

  const back = async () => {
    if (dirtyRef.current) await save();
    navigate("/notes");
  };

  const remove = async () => {
    if (!confirm("Delete this note? This can't be undone.")) return;
    if (noteIdRef.current) await api(`/notes/${noteIdRef.current}`, { method: "DELETE" });
    navigate("/notes");
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <BackButton onClick={() => void back()} />
        <span className="flex-1 text-sm text-gray-400">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
        <button
          className="text-red-500 active:opacity-60"
          aria-label="Delete note"
          title="Delete"
          onClick={() => void remove()}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden px-4 pt-3">
        <input
          className="mb-2 w-full bg-transparent text-xl font-semibold outline-none"
          placeholder="Title"
          value={title}
          onChange={(e) => edit(() => setTitle(e.target.value))}
        />
        <textarea
          className="kv-scroll flex-1 resize-none bg-transparent text-[17px] leading-snug outline-none"
          placeholder="Write something… only you can read it."
          value={body}
          onChange={(e) => edit(() => setBody(e.target.value))}
        />
      </div>
    </div>
  );
}
