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
import NoteMarkdown from "../components/NoteMarkdown";
import { toggleCheckbox } from "../lib/markdown";
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
  const [mode, setMode] = useState<"edit" | "read">(id === "new" ? "edit" : "read");

  const taRef = useRef<HTMLTextAreaElement>(null);
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

  const changeBody = (next: string) => edit(() => setBody(next));

  // Wrap the current selection with markers (bold/italic/code).
  const wrap = (marker: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = body.slice(s, e);
    changeBody(body.slice(0, s) + marker + sel + marker + body.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + marker.length;
      ta.selectionEnd = e + marker.length;
    });
  };

  // Prefix the current line (heading / bullet / checkbox).
  const prefixLine = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = body.lastIndexOf("\n", s - 1) + 1;
    changeBody(body.slice(0, lineStart) + prefix + body.slice(lineStart));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + prefix.length;
    });
  };

  const onCheckToggle = (index: number) => changeBody(toggleCheckbox(body, index));

  // Pressing Enter inside a list continues it (new bullet/checkbox/number); on an
  // empty item it exits the list instead.
  const onBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const ta = e.currentTarget;
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return;
    const lineStart = body.lastIndexOf("\n", pos - 1) + 1;
    const lineEnd = body.indexOf("\n", pos);
    const line = body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd);

    const task = line.match(/^(\s*)[-*]\s+\[[ xX]\]\s+(.*)$/);
    const bullet = line.match(/^(\s*)([-*])\s+(.*)$/);
    const num = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    let prefix: string | null = null;
    let empty = false;
    if (task) {
      prefix = `${task[1]}- [ ] `;
      empty = task[2].trim() === "";
    } else if (bullet) {
      prefix = `${bullet[1]}${bullet[2]} `;
      empty = bullet[3].trim() === "";
    } else if (num) {
      prefix = `${num[1]}${Number(num[2]) + 1}. `;
      empty = num[3].trim() === "";
    }
    if (!prefix) return;

    e.preventDefault();
    if (empty) {
      changeBody(body.slice(0, lineStart) + body.slice(pos));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = lineStart;
      });
    } else {
      const insert = `\n${prefix}`;
      changeBody(body.slice(0, pos) + insert + body.slice(pos));
      const next = pos + insert.length;
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = next;
      });
    }
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
          className="text-sm text-imsg-blue active:opacity-60"
          onClick={() => setMode((m) => (m === "edit" ? "read" : "edit"))}
        >
          {mode === "edit" ? "Done" : "Edit"}
        </button>
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

      {mode === "edit" ? (
        <div className="flex flex-1 flex-col overflow-hidden px-4 pt-3">
          <input
            className="mb-2 w-full bg-transparent text-xl font-semibold outline-none"
            placeholder="Title"
            value={title}
            onChange={(e) => edit(() => setTitle(e.target.value))}
          />
          <FormatBar
            onBold={() => wrap("**")}
            onItalic={() => wrap("_")}
            onHeading={() => prefixLine("# ")}
            onBullet={() => prefixLine("- ")}
            onCheckbox={() => prefixLine("- [ ] ")}
          />
          <textarea
            ref={taRef}
            className="kv-scroll mt-2 flex-1 resize-none bg-transparent text-[17px] leading-snug outline-none"
            placeholder="Write something… **bold**, - bullets, - [ ] checkboxes. Only you can read it."
            value={body}
            onChange={(e) => edit(() => setBody(e.target.value))}
            onKeyDown={onBodyKeyDown}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden px-4 pt-3">
          {title && <h1 className="mb-1 text-2xl font-bold">{title}</h1>}
          {body.trim() ? (
            <NoteMarkdown source={body} onToggle={onCheckToggle} />
          ) : (
            <button
              className="mt-4 text-left text-gray-400"
              onClick={() => setMode("edit")}
            >
              Empty note — tap Edit to write.
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FormatBar({
  onBold,
  onItalic,
  onHeading,
  onBullet,
  onCheckbox,
}: {
  onBold: () => void;
  onItalic: () => void;
  onHeading: () => void;
  onBullet: () => void;
  onCheckbox: () => void;
}) {
  // preventDefault on mousedown so tapping a button doesn't blur the textarea
  // (which would lose the selection we're about to format).
  const keep = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };
  const btn = "flex h-8 w-9 items-center justify-center rounded-lg text-imsg-blue active:bg-gray-100";
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <div className="flex gap-1 border-b border-gray-100 pb-2">
      <button className={`${btn} font-bold`} onMouseDown={keep(onBold)} aria-label="Bold">
        B
      </button>
      <button className={`${btn} italic font-serif`} onMouseDown={keep(onItalic)} aria-label="Italic">
        I
      </button>
      <button className={`${btn} font-semibold`} onMouseDown={keep(onHeading)} aria-label="Heading">
        H
      </button>
      <button className={btn} onMouseDown={keep(onBullet)} aria-label="Bulleted list">
        <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4.5" cy="6" r="1" />
          <circle cx="4.5" cy="12" r="1" />
          <circle cx="4.5" cy="18" r="1" />
        </svg>
      </button>
      <button className={btn} onMouseDown={keep(onCheckbox)} aria-label="Checklist">
        <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
          <polyline points="3 6 4.5 7.5 7 5" />
          <polyline points="3 17 4.5 18.5 7 16" />
          <line x1="11" y1="6" x2="20" y2="6" />
          <line x1="11" y1="17" x2="20" y2="17" />
        </svg>
      </button>
    </div>
  );
}
