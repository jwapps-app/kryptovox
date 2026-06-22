import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { conversationTitle, dayLabel } from "../lib/format";
import { getPrefs } from "../lib/prefs";
import { burnLabel, getBurnPref, setBurnPref } from "../lib/burn";
import { detectKeyChanges } from "../lib/keyPins";
import { cacheUserKeys } from "../lib/keys";
import Avatar from "../components/Avatar";
import BackButton from "../components/BackButton";
import ForwardSheet from "../components/ForwardSheet";
import MessageBubble from "../components/MessageBubble";
import TypingIndicator from "../components/TypingIndicator";
import InputBar from "../components/InputBar";
import type { Conversation, Message } from "../lib/types";

export default function ChatView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;

  const messages = useChat((s) => s.messagesByConv[id]) ?? [];
  const textByMessage = useChat((s) => s.textByMessage);
  const thumbByMessage = useChat((s) => s.thumbByMessage);
  const typing = useChat((s) => s.typingByConv[id]) ?? [];
  const readBy = useChat((s) => s.readByConv[id]) ?? {};
  const loadMessages = useChat((s) => s.loadMessages);
  const loadOlder = useChat((s) => s.loadOlder);
  const sendMessage = useChat((s) => s.sendMessage);
  const sendImage = useChat((s) => s.sendImage);
  const sendFile = useChat((s) => s.sendFile);
  const loadFile = useChat((s) => s.loadFile);
  const sendLocation = useChat((s) => s.sendLocation);
  const loadFullImage = useChat((s) => s.loadFullImage);
  const editMessage = useChat((s) => s.editMessage);
  const unsend = useChat((s) => s.unsend);
  const markRead = useChat((s) => s.markRead);
  const toggleReaction = useChat((s) => s.toggleReaction);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [keyAlerts, setKeyAlerts] = useState<string[]>([]);

  // Surface contacts whose identity key changed since we first saw it (TOFU).
  useEffect(() => {
    if (!conv) return setKeyAlerts([]);
    const changed = detectKeyChanges(conv.members, user.id);
    setKeyAlerts(
      conv.members
        .filter((m) => changed.includes(m.id))
        .map((m) => m.display_name || m.username)
    );
  }, [conv, user.id]);

  const doForward = async (target: Conversation) => {
    const m = forwarding;
    setForwarding(null);
    if (!m) return;
    const memberIds = target.members.map((x) => x.id);
    const content = textByMessage[m.id] ?? "";
    if (m.type === "location") {
      try {
        await sendLocation(target.id, JSON.parse(content), memberIds);
      } catch {
        /* malformed */
      }
    } else if (content) {
      await sendMessage(target.id, content, memberIds);
    }
    navigate(`/chat/${target.id}`);
  };
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  const openImage = async (m: Message) => {
    setViewerLoading(true);
    setViewerUrl(null);
    try {
      setViewerUrl(await loadFullImage(m));
    } catch {
      /* leave closed on failure */
    } finally {
      setViewerLoading(false);
    }
  };

  const openFile = async (m: Message) => {
    try {
      const url = await loadFile(m);
      const name = textByMessage[m.id] || "file";
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      /* best-effort */
    }
  };
  const closeViewer = () => {
    setViewerUrl(null);
    setViewerLoading(false);
  };
  const scrollRef = useRef<HTMLDivElement>(null);

  // We render the loaded messages directly (no virtualization). Variable-height
  // message bubbles made the virtualizer re-measure rows mid-scroll, which is
  // what made scrolling jerky. Messages load a page at a time, so the DOM stays
  // small and native scrolling is smooth.
  const stickToBottom = useRef(true);
  const loadingOlder = useRef(false);
  const scrollRaf = useRef<number | null>(null);

  useEffect(() => {
    void loadMessages(id);
    api<Conversation>(`/conversations/${id}`)
      .then((c) => {
        cacheUserKeys(c.members);
        setConv(c);
      })
      .catch(() => navigate("/"));
  }, [id, loadMessages, navigate]);

  // New conversation → start pinned to the latest message.
  useEffect(() => {
    stickToBottom.current = true;
  }, [id]);

  // Pin to the bottom as messages arrive, while the user is at the bottom.
  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, id]);

  // Re-pin to the bottom when the scroll container resizes — the on-screen
  // keyboard opening shrinks it, which would otherwise hide the latest messages
  // behind the keyboard/input bar. Only follows while parked at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mark the newest non-own message read (unless read receipts are disabled).
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.sender_id !== user.id && getPrefs().readReceipts) {
      void markRead(id, last.id);
    }
  }, [messages, id, user.id, markRead]);

  const title = conv ? conversationTitle(conv, user.id) : "";
  const memberIds = useMemo(() => conv?.members.map((m) => m.id) ?? [], [conv]);
  const othersTyping = typing.filter((u) => u !== user.id);

  // Disappearing messages: each carries its own window (disappear_seconds) and
  // its clock starts when read. Hide on time client-side (the server sweeps them
  // too within a couple of minutes); re-tick so they vanish without a reload.
  const disappearSecs = conv?.disappear_seconds ?? 0; // current setting (header)
  const hasEphemeral = useMemo(
    () => messages.some((m) => m.disappear_seconds > 0 && m.disappear_started_at),
    [messages]
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!hasEphemeral) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, [hasEphemeral]);
  const visible = useMemo(() => {
    return messages.filter((m) => {
      if (!m.disappear_seconds || !m.disappear_started_at) return true;
      return new Date(m.disappear_started_at).getTime() + m.disappear_seconds * 1000 > nowTick;
    });
  }, [messages, nowTick]);

  // Quick burn-after-reading toggle from the header. Off → restore the
  // conversation's remembered window (default 1h); on → off.
  const toggleBurn = async () => {
    if (!conv) return;
    const next = disappearSecs > 0 ? 0 : getBurnPref(id);
    try {
      const updated = await api<Conversation>(`/conversations/${id}/disappearing`, {
        method: "PATCH",
        body: JSON.stringify({ seconds: next }),
      });
      setConv(updated);
      if (next > 0) setBurnPref(id, next);
    } catch {
      /* ignore */
    }
  };

  // In-chat search: filter to messages whose decrypted text matches.
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const displayed = useMemo(() => {
    const q = chatQuery.trim().toLowerCase();
    if (!searchOpen || !q) return visible;
    return visible.filter((m) => (textByMessage[m.id] ?? "").toLowerCase().includes(q));
  }, [visible, searchOpen, chatQuery, textByMessage]);

  // Read status only applies to my most recent outgoing message.
  const lastMine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === user.id) return messages[i];
    }
    return null;
  }, [messages, user.id]);

  const statusFor = (m: Message): "sent" | "delivered" | "read" | null => {
    if (!lastMine || m.id !== lastMine.id) return null;
    const readByOther = Object.entries(readBy).some(([uid, mid]) => {
      if (uid === user.id) return false;
      const readMsg = messages.find((x) => x.id === mid);
      return readMsg ? readMsg.created_at >= m.created_at : false;
    });
    return readByOther ? "read" : "delivered";
  };

  // Coalesce scroll work to one frame so the layout reads (scrollHeight) don't
  // force a synchronous reflow on every scroll event.
  const onScroll = () => {
    if (scrollRaf.current != null) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      const el = scrollRef.current;
      if (!el) return;
      // Only auto-follow new content while the user is at the bottom.
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      // Load older history near the top, keeping the viewport anchored so the
      // content doesn't jump when older messages prepend.
      if (el.scrollTop < 60 && messages.length > 0 && !loadingOlder.current) {
        loadingOlder.current = true;
        const prevHeight = el.scrollHeight;
        const prevTop = el.scrollTop;
        void loadOlder(id).then(() => {
          requestAnimationFrame(() => {
            const el2 = scrollRef.current;
            if (el2) el2.scrollTop = el2.scrollHeight - prevHeight + prevTop;
            loadingOlder.current = false;
          });
        });
      }
    });
  };

  let prevDay = "";
  let prevSender: string | null = null;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <BackButton onClick={() => navigate("/")} />
        {conv &&
          (() => {
            const other =
              conv.type === "direct"
                ? conv.members.find((m) => m.id !== user.id)
                : undefined;
            return (
              <Avatar name={title} size={32} userId={other?.id} hasAvatar={other?.has_avatar} />
            );
          })()}
        <span className="font-semibold">{title}</span>
        <button
          className="ml-auto text-imsg-blue active:opacity-60"
          aria-label="Search"
          onClick={() => {
            setSearchOpen((v) => !v);
            setChatQuery("");
          }}
        >
          <svg
            width="23"
            height="23"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
        <button
          className="text-xl text-imsg-blue"
          aria-label="Info"
          onClick={() => navigate(`/chat/${id}/info`)}
        >
          ⓘ
        </button>
      </header>

      {/* Burn-after-reading toggle bar — always visible so the state + window
          are clear at a glance. */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-1.5">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={disappearSecs > 0 ? "text-imsg-blue" : "text-gray-400"}
        >
          <line x1="10" y1="2" x2="14" y2="2" />
          <line x1="12" y1="14" x2="15" y2="11" />
          <circle cx="12" cy="14" r="8" />
        </svg>
        <span className="text-sm">
          {disappearSecs > 0 ? (
            <>
              Disappearing ·{" "}
              <span className="font-medium text-imsg-blue">{burnLabel(disappearSecs)}</span>
            </>
          ) : (
            <span className="text-gray-500">Disappearing messages</span>
          )}
        </span>
        {disappearSecs > 0 && (
          <button
            className="text-xs text-imsg-blue"
            onClick={() => navigate(`/chat/${id}/info`)}
          >
            Change
          </button>
        )}
        <button
          onClick={() => void toggleBurn()}
          role="switch"
          aria-checked={disappearSecs > 0}
          aria-label="Disappearing messages"
          className={`ml-auto flex h-6 w-10 shrink-0 items-center rounded-full px-0.5 transition-colors ${
            disappearSecs > 0 ? "justify-end" : "justify-start"
          }`}
          style={{ background: disappearSecs > 0 ? "#34C759" : "#E9E9EB" }}
        >
          <span className="h-5 w-5 rounded-full shadow" style={{ background: "#fff" }} />
        </button>
      </div>

      {keyAlerts.length > 0 && (
        <button
          onClick={() => navigate(`/chat/${id}/info`)}
          className="flex w-full items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-left text-sm text-red-600"
        >
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
            className="shrink-0"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            {keyAlerts.join(", ")}’s safety number changed. Tap to verify before
            trusting.
          </span>
        </button>
      )}

      {searchOpen && (
        <div className="border-b border-gray-100 px-3 py-2">
          <input
            autoFocus
            className="w-full rounded-xl bg-gray-100 px-4 py-2 text-[15px] outline-none"
            placeholder="Search this conversation"
            autoCapitalize="none"
            value={chatQuery}
            onChange={(e) => setChatQuery(e.target.value)}
          />
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="no-scrollbar kv-scroll flex-1 overflow-y-auto py-3"
      >
        {displayed.length === 0 ? (
          <div className="mt-10 text-center text-gray-400">
            {searchOpen && chatQuery.trim() ? "No matches" : "No messages yet. Say hi 👋"}
          </div>
        ) : (
          <div className="flex flex-col">
            {displayed.map((m, i) => {
              const day = dayLabel(m.created_at);
              const showDay = day !== prevDay;
              prevDay = day;
              const next = displayed[i + 1];
              const isLastInGroup = !next || next.sender_id !== m.sender_id;
              const showSender =
                conv?.type === "group" &&
                m.sender_id !== user.id &&
                m.sender_id !== prevSender;
              prevSender = m.sender_id;
              const senderName =
                conv?.members.find((mem) => mem.id === m.sender_id)?.display_name ?? "";
              const replyText = m.reply_to_id
                ? textByMessage[m.reply_to_id] ?? "…"
                : null;

              return (
                <div key={m.id}>
                  {showDay && (
                    <div className="my-2 text-center text-xs font-medium text-gray-400">
                      {day}
                    </div>
                  )}
                  {showSender && senderName && (
                    <div className="px-4 pb-0.5 text-[11px] text-gray-400">
                      {senderName}
                    </div>
                  )}
                  <MessageBubble
                    message={m}
                    text={textByMessage[m.id] ?? ""}
                    isMine={m.sender_id === user.id}
                    isLastInGroup={isLastInGroup}
                    currentUserId={user.id}
                    replyText={replyText}
                    status={statusFor(m)}
                    thumbUrl={thumbByMessage[m.id]}
                    onOpenImage={openImage}
                    onOpenFile={openFile}
                    onReact={(mid, emoji) => toggleReaction(id, mid, emoji, user.id)}
                    onReply={(msg) => setReplyTo(msg)}
                    onUnsend={(mid) => unsend(mid, id)}
                    onEdit={(msg) => {
                      setReplyTo(null);
                      setEditing(msg);
                    }}
                    onForward={(msg) => setForwarding(msg)}
                  />
                </div>
              );
            })}
          </div>
        )}
        {othersTyping.length > 0 && <TypingIndicator />}
      </div>

      <InputBar
        conversationId={id}
        replyPreview={replyTo ? textByMessage[replyTo.id] ?? "" : null}
        onCancelReply={() => setReplyTo(null)}
        onSend={async (text) => {
          await sendMessage(id, text, memberIds, replyTo?.id ?? null);
          setReplyTo(null);
        }}
        onSendImage={(file) => sendImage(id, file, memberIds)}
        onSendFile={(file) => sendFile(id, file, memberIds)}
        onSendLocation={(coords) => sendLocation(id, coords, memberIds)}
        editing={editing ? { id: editing.id, text: textByMessage[editing.id] ?? "" } : null}
        onSubmitEdit={(newText) => editMessage(editing!.id, id, newText, memberIds)}
        onCancelEdit={() => setEditing(null)}
      />

      {forwarding && (
        <ForwardSheet onClose={() => setForwarding(null)} onPick={(c) => void doForward(c)} />
      )}

      {(viewerLoading || viewerUrl) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={closeViewer}
        >
          {viewerUrl ? (
            <img
              src={viewerUrl}
              alt="Photo"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="text-white">Loading…</div>
          )}
        </div>
      )}
    </div>
  );
}
