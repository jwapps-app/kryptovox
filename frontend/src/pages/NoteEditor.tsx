import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import {
  decryptFileToUrl,
  decryptWithKey,
  encryptFileWithKey,
  encryptWithKey,
  generateThreadKey,
  unwrapKeyForSelf,
  wrapKeyForSelf,
} from "../crypto/guest";
import { fetchNoteMedia, uploadNoteMedia } from "../lib/media";
import BackButton from "../components/BackButton";
import RichNoteEditor from "../components/RichNoteEditor";
import type { Note, NoteAttachment } from "../lib/types";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NoteEditor() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const identity = useAuth((s) => s.identity);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [loaded, setLoaded] = useState(false);
  const [attachments, setAttachmentsState] = useState<NoteAttachment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({}); // media_id -> filename
  const [attaching, setAttaching] = useState(false);

  const keyRef = useRef<CryptoKey | null>(null);
  const rawRef = useRef<string | null>(null); // raw key, for the first wrap-to-self
  const noteIdRef = useRef<string | null>(id === "new" ? null : id);
  const attachRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<NoteAttachment[]>([]); // mirror, for save() closures
  const dirtyRef = useRef(false);

  const setAttachments = (next: NoteAttachment[]) => {
    attachmentsRef.current = next;
    setAttachmentsState(next);
  };

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
        setAttachments(n.attachments ?? []);
        const decoded: Record<string, string> = {};
        for (const a of n.attachments ?? []) {
          try {
            decoded[a.media_id] = await decryptWithKey(key, a.name_ciphertext, a.name_iv);
          } catch {
            decoded[a.media_id] = "file";
          }
        }
        if (!alive) return;
        setNames(decoded);
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

  // Create the note (possibly empty) if it doesn't exist yet, returning its id.
  // Used by save() and before uploading an attachment (which needs the id).
  const ensureNote = useCallback(async (): Promise<string | null> => {
    if (noteIdRef.current) return noteIdRef.current;
    const key = keyRef.current;
    if (!key || !identity || !user.identity_public_key) return null;
    const wrapped = await wrapKeyForSelf(
      rawRef.current!,
      identity.privateKey,
      user.identity_public_key
    );
    const t = await encryptWithKey(key, title);
    const b = await encryptWithKey(key, body);
    const created = await api<Note>("/notes", {
      method: "POST",
      body: JSON.stringify({
        wrapped_key: wrapped,
        title_ciphertext: t.ciphertext,
        title_iv: t.iv,
        body_ciphertext: b.ciphertext,
        body_iv: b.iv,
        attachments: attachmentsRef.current,
      }),
    });
    noteIdRef.current = created.id;
    window.history.replaceState(null, "", `/notes/${created.id}`);
    return created.id;
  }, [title, body, identity, user.identity_public_key]);

  const save = useCallback(async () => {
    const key = keyRef.current;
    if (!key || !identity || !user.identity_public_key) return;
    if (!noteIdRef.current && !title.trim() && !body.trim() && attachmentsRef.current.length === 0) {
      return; // nothing to create
    }
    setStatus("saving");
    try {
      if (!noteIdRef.current) {
        await ensureNote();
      } else {
        const t = await encryptWithKey(key, title);
        const b = await encryptWithKey(key, body);
        await api(`/notes/${noteIdRef.current}`, {
          method: "PATCH",
          body: JSON.stringify({
            title_ciphertext: t.ciphertext,
            title_iv: t.iv,
            body_ciphertext: b.ciphertext,
            body_iv: b.iv,
            attachments: attachmentsRef.current,
          }),
        });
      }
      dirtyRef.current = false;
      setStatus("saved");
    } catch {
      setStatus("idle");
    }
  }, [title, body, identity, user.identity_public_key, ensureNote]);

  const addAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const key = keyRef.current;
    if (!file || !key || attaching) return;
    setAttaching(true);
    try {
      const noteId = await ensureNote();
      if (!noteId) return;
      const name = await encryptWithKey(key, file.name);
      const f = await encryptFileWithKey(file, key);
      const mediaId = await uploadNoteMedia(noteId, f.blob);
      setNames((m) => ({ ...m, [mediaId]: file.name }));
      setAttachments([
        ...attachmentsRef.current,
        {
          media_id: mediaId,
          name_ciphertext: name.ciphertext,
          name_iv: name.iv,
          iv: f.media.iv,
          mime: f.media.mime,
          size: f.media.size,
        },
      ]);
      dirtyRef.current = true;
      await save();
    } catch {
      /* best-effort */
    } finally {
      setAttaching(false);
    }
  };

  const downloadAttachment = async (a: NoteAttachment) => {
    const key = keyRef.current;
    if (!key || !noteIdRef.current) return;
    try {
      const bytes = await fetchNoteMedia(noteIdRef.current, a.media_id);
      const url = await decryptFileToUrl(bytes, a.iv, a.mime, key);
      const el = document.createElement("a");
      el.href = url;
      el.download = names[a.media_id] || "file";
      el.rel = "noopener";
      document.body.appendChild(el);
      el.click();
      el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      /* best-effort */
    }
  };

  const removeAttachment = async (mediaId: string) => {
    setAttachments(attachmentsRef.current.filter((a) => a.media_id !== mediaId));
    dirtyRef.current = true;
    await save();
  };

  // Debounced autosave while editing.
  useEffect(() => {
    if (!loaded || !dirtyRef.current) return;
    const t = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(t);
  }, [title, body, loaded, save]);

  const onTitle = (v: string) => {
    dirtyRef.current = true;
    setStatus("idle");
    setTitle(v);
  };
  const onBody = useCallback((md: string) => {
    dirtyRef.current = true;
    setStatus("idle");
    setBody(md);
  }, []);

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
          onChange={(e) => onTitle(e.target.value)}
        />

        <div className="mb-2 flex flex-wrap items-center gap-2">
          {attachments.map((a) => (
            <span
              key={a.media_id}
              className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs"
            >
              <button
                onClick={() => void downloadAttachment(a)}
                className="flex items-center gap-1 text-imsg-blue"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="max-w-[150px] truncate">{names[a.media_id] || "file"}</span>
                <span className="text-gray-400">{formatBytes(a.size)}</span>
              </button>
              <button
                onClick={() => void removeAttachment(a.media_id)}
                aria-label="Remove attachment"
                className="px-0.5 text-gray-400 active:opacity-60"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            onClick={() => attachRef.current?.click()}
            disabled={attaching}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-imsg-blue disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            {attaching ? "Adding…" : "Attach"}
          </button>
          <input ref={attachRef} type="file" hidden onChange={addAttachment} />
        </div>

        {loaded && <RichNoteEditor initial={body} onChange={onBody} />}
      </div>
    </div>
  );
}
