import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { decryptWithKey, unwrapKeyForSelf } from "../crypto/guest";
import { conversationTitle } from "../lib/format";
import BottomTabs from "../components/BottomTabs";
import ConversationRow from "../components/ConversationRow";
import GuestThreadRow from "../components/GuestThreadRow";
import NewMessageSheet from "../components/NewMessageSheet";
import NewGroupSheet from "../components/NewGroupSheet";
import NewSecretLinkSheet from "../components/NewSecretLinkSheet";
import type { Conversation, GuestThreadSummary } from "../lib/types";

type Item =
  | { kind: "conv"; id: string; t: number; conv: Conversation }
  | { kind: "guest"; id: string; t: number; thread: GuestThreadSummary };

export default function ConversationList() {
  const user = useAuth((s) => s.user)!;
  const identity = useAuth((s) => s.identity);
  const conversations = useChat((s) => s.conversations);
  const textByMessage = useChat((s) => s.textByMessage);
  const loadConversations = useChat((s) => s.loadConversations);
  const leaveConversation = useChat((s) => s.leaveConversation);
  const markUnread = useChat((s) => s.markUnread);
  const guestReplyTick = useChat((s) => s.guestReplyTick);
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState<GuestThreadSummary[]>([]);
  const [guestText, setGuestText] = useState<Record<string, { label: string; preview: string }>>(
    {}
  );

  const loadGuests = useCallback(async () => {
    const list = await api<GuestThreadSummary[]>("/links").catch(() => []);
    setGuests(list);
    if (!identity || !user.identity_public_key) return;
    const decoded: Record<string, { label: string; preview: string }> = {};
    await Promise.all(
      list.map(async (t) => {
        try {
          const key = await unwrapKeyForSelf(
            t.wrapped_key,
            identity.privateKey,
            user.identity_public_key!
          );
          const label =
            t.label_ciphertext && t.label_iv
              ? await decryptWithKey(key, t.label_ciphertext, t.label_iv)
              : "Secret link";
          const preview = !t.last
            ? ""
            : t.last.type === "image"
              ? "📷 Photo"
              : t.last.type === "location"
                ? "📍 Location"
                : t.last.type === "file"
                  ? `📎 ${await decryptWithKey(key, t.last.ciphertext, t.last.iv)}`
                  : await decryptWithKey(key, t.last.ciphertext, t.last.iv);
          decoded[t.id] = { label, preview };
        } catch {
          decoded[t.id] = { label: "Secret link", preview: "…" };
        }
      })
    );
    setGuestText(decoded);
  }, [identity, user.identity_public_key]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);
  useEffect(() => {
    void loadGuests();
  }, [loadGuests, guestReplyTick]);

  const revokeGuest = async (id: string) => {
    await api(`/links/${id}`, { method: "DELETE" }).catch(() => {});
    setGuests((g) => g.filter((t) => t.id !== id));
  };

  // Stable handlers for the memoized rows (they pass their own id back).
  const openConv = useCallback((id: string) => navigate(`/chat/${id}`), [navigate]);
  const deleteConv = useCallback(
    (id: string) => void leaveConversation(id),
    [leaveConversation]
  );
  const unreadConv = useCallback((id: string) => void markUnread(id), [markUnread]);

  // Merge conversations + secret-link threads into one list, newest first.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const c of conversations) {
      out.push({
        kind: "conv",
        id: c.id,
        t: c.last_message ? Date.parse(c.last_message.created_at) : 0,
        conv: c,
      });
    }
    for (const g of guests) {
      out.push({ kind: "guest", id: g.id, t: Date.parse(g.last_message_at), thread: g });
    }
    return out.sort((a, b) => {
      const ap = a.kind === "conv" && a.conv.pinned ? 1 : 0;
      const bp = b.kind === "conv" && b.conv.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap; // pinned conversations first
      return b.t - a.t;
    });
  }, [conversations, guests]);

  // Filter by title, participant names, or the (decrypted) last-message preview.
  const filtered = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      if (item.kind === "conv") {
        const c = item.conv;
        const hay = [
          conversationTitle(c, user.id),
          ...c.members.map((m) => `${m.display_name ?? ""} ${m.username}`),
          c.last_message ? textByMessage[c.last_message.id] ?? "" : "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      }
      const g = guestText[item.id];
      return `${g?.label ?? ""} ${g?.preview ?? ""}`.toLowerCase().includes(q);
    });
  }, [items, query, textByMessage, guestText, user.id]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="relative z-20 flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <button
          className="text-imsg-blue active:opacity-60"
          aria-label="Settings"
          onClick={() => navigate("/settings")}
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
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold">Messages</h1>
        <button
          className="text-imsg-blue active:opacity-60"
          aria-label="New"
          onClick={() => setMenuOpen((v) => !v)}
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
        {menuOpen && (
          <div className="absolute right-3 top-12 z-10 w-44 overflow-hidden rounded-xl bg-white shadow-lg">
            <button
              className="block w-full px-4 py-2 text-left hover:bg-gray-50"
              onClick={() => {
                setMenuOpen(false);
                setSheetOpen(true);
              }}
            >
              New Message
            </button>
            <button
              className="block w-full border-t border-gray-100 px-4 py-2 text-left hover:bg-gray-50"
              onClick={() => {
                setMenuOpen(false);
                setGroupOpen(true);
              }}
            >
              New Group
            </button>
            <button
              className="block w-full border-t border-gray-100 px-4 py-2 text-left hover:bg-gray-50"
              onClick={() => {
                setMenuOpen(false);
                setLinkOpen(true);
              }}
            >
              New Secret Link
            </button>
          </div>
        )}
      </header>

      <div className="px-3 py-2">
        <input
          className="w-full rounded-xl bg-gray-100 px-4 py-2 text-[15px] outline-none"
          placeholder="Search"
          autoCapitalize="none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ul className="kv-scroll flex-1 overflow-y-auto">
        {items.length === 0 && (
          <li className="px-4 py-10 text-center text-gray-400">
            No conversations yet.
            <br />
            Tap ✎ to start one.
          </li>
        )}
        {items.length > 0 && filtered.length === 0 && (
          <li className="px-4 py-10 text-center text-gray-400">No matches</li>
        )}
        {filtered.map((item) =>
          item.kind === "conv" ? (
            <ConversationRow
              key={`c-${item.id}`}
              conversation={item.conv}
              currentUserId={user.id}
              preview={
                item.conv.last_message
                  ? item.conv.last_message.type === "image"
                    ? "📷 Photo"
                    : item.conv.last_message.type === "location"
                      ? "📍 Location"
                      : item.conv.last_message.type === "file"
                        ? `📎 ${textByMessage[item.conv.last_message.id] ?? "File"}`
                        : textByMessage[item.conv.last_message.id] ?? "…"
                  : "No messages yet"
              }
              onOpen={openConv}
              onDelete={deleteConv}
              onMarkUnread={unreadConv}
            />
          ) : (
            <GuestThreadRow
              key={`g-${item.id}`}
              thread={item.thread}
              label={guestText[item.id]?.label ?? "Secret link"}
              preview={guestText[item.id]?.preview ?? "…"}
              onOpen={() => navigate(`/links/${item.id}`)}
              onDelete={() => void revokeGuest(item.id)}
            />
          )
        )}
      </ul>

      <BottomTabs />

      {sheetOpen && <NewMessageSheet onClose={() => setSheetOpen(false)} />}
      {groupOpen && <NewGroupSheet onClose={() => setGroupOpen(false)} />}
      {linkOpen && (
        <NewSecretLinkSheet
          onClose={() => {
            setLinkOpen(false);
            void loadGuests();
          }}
        />
      )}
    </div>
  );
}
