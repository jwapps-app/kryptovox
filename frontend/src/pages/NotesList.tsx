import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { decryptWithKey, unwrapKeyForSelf } from "../crypto/guest";
import BottomTabs from "../components/BottomTabs";
import NoteRow from "../components/NoteRow";
import type { NoteListItem } from "../lib/types";

export default function NotesList() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const identity = useAuth((s) => s.identity);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const list = await api<NoteListItem[]>("/notes").catch(() => []);
    setNotes(list);
    if (!identity || !user.identity_public_key) return;
    const decoded: Record<string, string> = {};
    for (const n of list) {
      try {
        const key = await unwrapKeyForSelf(
          n.wrapped_key,
          identity.privateKey,
          user.identity_public_key
        );
        decoded[n.id] = n.title_ciphertext
          ? await decryptWithKey(key, n.title_ciphertext, n.title_iv)
          : "";
      } catch {
        decoded[n.id] = "";
      }
    }
    setTitles(decoded);
  }, [identity, user.identity_public_key]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (noteId: string) => {
    setNotes((n) => n.filter((x) => x.id !== noteId));
    await api(`/notes/${noteId}`, { method: "DELETE" }).catch(() => void load());
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h1 className="text-lg font-semibold">Notes</h1>
        <button
          className="text-imsg-blue active:opacity-60"
          aria-label="New note"
          onClick={() => navigate("/notes/new")}
        >
          <svg
            width="25"
            height="25"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
          </svg>
        </button>
      </header>

      <ul className="kv-scroll flex-1 overflow-y-auto">
        {notes.length === 0 && (
          <li className="px-4 py-10 text-center text-gray-400">
            No notes yet.
            <br />
            Tap ✎ to write one. Only you can read them.
          </li>
        )}
        {notes.map((n) => (
          <NoteRow
            key={n.id}
            title={titles[n.id] ?? ""}
            updatedAt={n.updated_at}
            onOpen={() => navigate(`/notes/${n.id}`)}
            onDelete={() => void remove(n.id)}
          />
        ))}
      </ul>

      <BottomTabs />
    </div>
  );
}
