import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { conversationTitle, dayLabel } from "../lib/format";
import { getPrefs } from "../lib/prefs";
import { cacheUserKeys } from "../lib/keys";
import Avatar from "../components/Avatar";
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
  const typing = useChat((s) => s.typingByConv[id]) ?? [];
  const readBy = useChat((s) => s.readByConv[id]) ?? {};
  const loadMessages = useChat((s) => s.loadMessages);
  const loadOlder = useChat((s) => s.loadOlder);
  const sendMessage = useChat((s) => s.sendMessage);
  const unsend = useChat((s) => s.unsend);
  const markRead = useChat((s) => s.markRead);
  const toggleReaction = useChat((s) => s.toggleReaction);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // We render the loaded messages directly (no virtualization). Variable-height
  // message bubbles made the virtualizer re-measure rows mid-scroll, which is
  // what made scrolling jerky. Messages load a page at a time, so the DOM stays
  // small and native scrolling is smooth.
  const stickToBottom = useRef(true);
  const loadingOlder = useRef(false);

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

  const onScroll = () => {
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
  };

  let prevDay = "";
  let prevSender: string | null = null;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <button className="text-2xl text-imsg-blue" onClick={() => navigate("/")}>
          ‹
        </button>
        {conv && <Avatar name={title} size={32} />}
        <span className="font-semibold">{title}</span>
        <button
          className="ml-auto text-xl text-imsg-blue"
          aria-label="Info"
          onClick={() => navigate(`/chat/${id}/info`)}
        >
          ⓘ
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="no-scrollbar flex-1 overflow-y-auto py-3"
      >
        {messages.length === 0 ? (
          <div className="mt-10 text-center text-gray-400">
            No messages yet. Say hi 👋
          </div>
        ) : (
          <div className="flex flex-col">
            {messages.map((m, i) => {
              const day = dayLabel(m.created_at);
              const showDay = day !== prevDay;
              prevDay = day;
              const next = messages[i + 1];
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
                    onReact={(mid, emoji) => toggleReaction(id, mid, emoji, user.id)}
                    onReply={(msg) => setReplyTo(msg)}
                    onUnsend={(mid) => unsend(mid, id)}
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
      />
    </div>
  );
}
