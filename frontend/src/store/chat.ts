import { create } from "zustand";
import { api } from "../lib/api";
import { cacheUserKeys, gatherRecipients, getUserPublicKey } from "../lib/keys";
import { syncBadge } from "../lib/badge";
import { decryptMessage, encryptMessage } from "../crypto/messaging";
import { decryptFull, decryptThumb, encryptImage } from "../crypto/media";
import { fetchMedia, uploadMedia } from "../lib/media";
import { useAuth } from "./auth";
import type { Conversation, Message, MessagePage, WsEvent } from "../lib/types";

interface ChatState {
  conversations: Conversation[];
  messagesByConv: Record<string, Message[]>;
  textByMessage: Record<string, string>;
  thumbByMessage: Record<string, string>; // messageId -> decrypted thumbnail object URL
  cursorByConv: Record<string, string | null>;
  typingByConv: Record<string, string[]>; // userIds currently typing
  // conversationId -> userId -> messageId they last read
  readByConv: Record<string, Record<string, string>>;
  loadConversations: () => Promise<void>;
  leaveConversation: (conversationId: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  loadOlder: (conversationId: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    text: string,
    memberIds: string[],
    replyToId?: string | null
  ) => Promise<void>;
  sendImage: (conversationId: string, file: File, memberIds: string[]) => Promise<void>;
  loadFullImage: (message: Message) => Promise<string>;
  unsend: (messageId: string, conversationId: string) => Promise<void>;
  markRead: (conversationId: string, messageId: string) => Promise<void>;
  markUnread: (conversationId: string) => Promise<void>;
  toggleReaction: (
    conversationId: string,
    messageId: string,
    emoji: string,
    userId: string
  ) => Promise<void>;
  handleWsEvent: (event: WsEvent) => Promise<void>;
}

async function decryptThumbForMe(msg: Message): Promise<string | null> {
  if (msg.type !== "image" || !msg.media || msg.deleted_at) return null;
  const { identity, user } = useAuth.getState();
  if (!identity || !user || !msg.sender_id) return null;
  const wrapped = msg.encrypted_keys[user.id];
  if (!wrapped) return null;
  const senderPub = await getUserPublicKey(msg.sender_id);
  if (!senderPub) return null;
  try {
    const blob = await decryptThumb(msg.media, wrapped, senderPub, identity.privateKey);
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function decryptForMe(msg: Message): Promise<string> {
  if (msg.deleted_at || msg.type === "image") return "";
  const { identity, user } = useAuth.getState();
  if (!identity || !user) return "🔒";
  const wrapped = msg.encrypted_keys[user.id];
  if (!wrapped) return "[not encrypted for you]";
  if (!msg.sender_id) return "[unknown sender]";
  const senderPub = await getUserPublicKey(msg.sender_id);
  if (!senderPub) return "[unknown sender key]";
  try {
    return await decryptMessage(
      msg.ciphertext,
      msg.iv,
      wrapped,
      senderPub,
      identity.privateKey
    );
  } catch {
    return "[unable to decrypt]";
  }
}

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  messagesByConv: {},
  textByMessage: {},
  thumbByMessage: {},
  cursorByConv: {},
  typingByConv: {},
  readByConv: {},

  loadConversations: async () => {
    const conversations = await api<Conversation[]>("/conversations");
    // Seed identity-key cache from members to avoid extra lookups.
    for (const c of conversations) cacheUserKeys(c.members);
    // Decrypt last-message previews.
    const texts: Record<string, string> = {};
    await Promise.all(
      conversations.map(async (c) => {
        if (c.last_message) texts[c.last_message.id] = await decryptForMe(c.last_message);
      })
    );
    set((s) => ({ conversations, textByMessage: { ...s.textByMessage, ...texts } }));
    syncBadge(conversations);
  },

  leaveConversation: async (conversationId) => {
    await api(`/conversations/${conversationId}/leave`, { method: "POST" });
    set((s) => {
      const messagesByConv = { ...s.messagesByConv };
      delete messagesByConv[conversationId];
      return {
        conversations: s.conversations.filter((c) => c.id !== conversationId),
        messagesByConv,
      };
    });
    syncBadge(get().conversations);
  },

  loadMessages: async (conversationId) => {
    const page = await api<MessagePage>(`/conversations/${conversationId}/messages`);
    const texts: Record<string, string> = {};
    const thumbs: Record<string, string> = {};
    await Promise.all(
      page.messages.map(async (m) => {
        texts[m.id] = await decryptForMe(m);
        const t = await decryptThumbForMe(m);
        if (t) thumbs[m.id] = t;
      })
    );
    set((s) => ({
      messagesByConv: { ...s.messagesByConv, [conversationId]: page.messages },
      cursorByConv: { ...s.cursorByConv, [conversationId]: page.next_cursor },
      textByMessage: { ...s.textByMessage, ...texts },
      thumbByMessage: { ...s.thumbByMessage, ...thumbs },
    }));
  },

  loadOlder: async (conversationId) => {
    const cursor = get().cursorByConv[conversationId];
    if (!cursor) return;
    const page = await api<MessagePage>(
      `/conversations/${conversationId}/messages?cursor=${encodeURIComponent(cursor)}`
    );
    const texts: Record<string, string> = {};
    const thumbs: Record<string, string> = {};
    await Promise.all(
      page.messages.map(async (m) => {
        texts[m.id] = await decryptForMe(m);
        const t = await decryptThumbForMe(m);
        if (t) thumbs[m.id] = t;
      })
    );
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: [...page.messages, ...(s.messagesByConv[conversationId] ?? [])],
      },
      cursorByConv: { ...s.cursorByConv, [conversationId]: page.next_cursor },
      textByMessage: { ...s.textByMessage, ...texts },
      thumbByMessage: { ...s.thumbByMessage, ...thumbs },
    }));
  },

  sendMessage: async (conversationId, text, memberIds, replyToId = null) => {
    const { identity } = useAuth.getState();
    if (!identity) throw new Error("No identity");
    const recipients = await gatherRecipients(memberIds);
    const enc = await encryptMessage(text, recipients, identity.privateKey);
    const msg = await api<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ ...enc, type: "text", reply_to_id: replyToId }),
    });
    // The server fans out a message.new WS echo during this POST, which can
    // arrive before this response resolves — so append idempotently (dedupe by
    // id) to avoid showing our own message twice. We always set the plaintext
    // since we know it locally.
    set((s) => {
      const existing = s.messagesByConv[conversationId] ?? [];
      const already = existing.some((m) => m.id === msg.id);
      return {
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: already ? existing : [...existing, msg],
        },
        textByMessage: { ...s.textByMessage, [msg.id]: text },
      };
    });
  },

  sendImage: async (conversationId, file, memberIds) => {
    const { identity } = useAuth.getState();
    if (!identity) throw new Error("No identity");
    const recipients = await gatherRecipients(memberIds);
    const enc = await encryptImage(file, recipients, identity.privateKey);
    const id = await uploadMedia(enc.blob);
    const msg = await api<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        encrypted_keys: enc.encrypted_keys,
        type: "image",
        media: { ...enc.media, id },
      }),
    });
    // Show our own image instantly from the local file (no round-trip decrypt).
    const localUrl = URL.createObjectURL(file);
    set((s) => {
      const existing = s.messagesByConv[conversationId] ?? [];
      const already = existing.some((m) => m.id === msg.id);
      return {
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: already ? existing : [...existing, msg],
        },
        thumbByMessage: { ...s.thumbByMessage, [msg.id]: localUrl },
      };
    });
  },

  loadFullImage: async (message) => {
    const { identity, user } = useAuth.getState();
    if (!identity || !user || !message.media || !message.sender_id) {
      throw new Error("Cannot load image");
    }
    const wrapped = message.encrypted_keys[user.id];
    const senderPub = await getUserPublicKey(message.sender_id);
    if (!wrapped || !senderPub) throw new Error("No key for this image");
    const cipher = await fetchMedia(message.media.id);
    const blob = await decryptFull(message.media, cipher, wrapped, senderPub, identity.privateKey);
    return URL.createObjectURL(blob);
  },

  unsend: async (messageId, conversationId) => {
    await api<Message>(`/messages/${messageId}`, { method: "DELETE" });
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
        ),
      },
      textByMessage: { ...s.textByMessage, [messageId]: "" },
    }));
  },

  toggleReaction: async (conversationId, messageId, emoji, userId) => {
    const msgs = get().messagesByConv[conversationId] ?? [];
    const msg = msgs.find((m) => m.id === messageId);
    const mine = msg?.reactions.some((r) => r.emoji === emoji && r.user_id === userId);

    // Optimistic local update.
    const apply = (reactions: Message["reactions"]) =>
      mine
        ? reactions.filter((r) => !(r.emoji === emoji && r.user_id === userId))
        : [...reactions, { emoji, user_id: userId }];
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, reactions: apply(m.reactions) } : m
        ),
      },
    }));

    try {
      if (mine) {
        await api(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
          method: "DELETE",
        });
      } else {
        await api(`/messages/${messageId}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji }),
        });
      }
    } catch {
      /* the WS echo will reconcile if this fails */
    }
  },

  markRead: async (conversationId, messageId) => {
    try {
      await api(`/conversations/${conversationId}/read/${messageId}`, { method: "POST" });
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === conversationId ? { ...c, unread_count: 0 } : c
        ),
      }));
      syncBadge(get().conversations);
    } catch {
      /* best-effort */
    }
  },

  markUnread: async (conversationId) => {
    await api(`/conversations/${conversationId}/unread`, { method: "POST" });
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unread_count: Math.max(1, c.unread_count) } : c
      ),
    }));
    syncBadge(get().conversations);
  },

  handleWsEvent: async (event) => {
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case "message.new": {
        const msg = p as unknown as Message;
        const text = await decryptForMe(msg);
        const thumb = await decryptThumbForMe(msg);
        // Dedupe atomically inside the updater: the early check + later append
        // otherwise race (own-send echo, or two events for the same id) and
        // produce a duplicate. Reading fresh `s` here closes that window.
        set((s) => {
          const existing = s.messagesByConv[msg.conversation_id] ?? [];
          if (existing.some((m) => m.id === msg.id)) {
            return { textByMessage: { ...s.textByMessage, [msg.id]: text } };
          }
          return {
            messagesByConv: {
              ...s.messagesByConv,
              [msg.conversation_id]: [...existing, msg],
            },
            textByMessage: { ...s.textByMessage, [msg.id]: text },
            thumbByMessage: thumb
              ? { ...s.thumbByMessage, [msg.id]: thumb }
              : s.thumbByMessage,
          };
        });
        // Refresh conversation ordering / previews.
        get().loadConversations();
        break;
      }
      case "message.delete": {
        const id = p.id as string;
        const convId = p.conversation_id as string;
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [convId]: (s.messagesByConv[convId] ?? []).map((m) =>
              m.id === id ? { ...m, deleted_at: new Date().toISOString() } : m
            ),
          },
          textByMessage: { ...s.textByMessage, [id]: "" },
        }));
        break;
      }
      case "typing.start":
      case "typing.stop": {
        const convId = p.conversation_id as string;
        const userId = p.user_id as string;
        set((s) => {
          const current = new Set(s.typingByConv[convId] ?? []);
          if (event.type === "typing.start") current.add(userId);
          else current.delete(userId);
          return { typingByConv: { ...s.typingByConv, [convId]: [...current] } };
        });
        break;
      }
      case "reaction.add":
      case "reaction.remove": {
        const convId = p.conversation_id as string;
        const messageId = p.message_id as string;
        const userId = p.user_id as string;
        const emoji = p.emoji as string;
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [convId]: (s.messagesByConv[convId] ?? []).map((m) => {
              if (m.id !== messageId) return m;
              const without = m.reactions.filter(
                (r) => !(r.emoji === emoji && r.user_id === userId)
              );
              return {
                ...m,
                reactions:
                  event.type === "reaction.add"
                    ? [...without, { emoji, user_id: userId }]
                    : without,
              };
            }),
          },
        }));
        break;
      }
      case "receipt.read": {
        const convId = p.conversation_id as string;
        const userId = p.user_id as string;
        const messageId = p.message_id as string;
        set((s) => ({
          readByConv: {
            ...s.readByConv,
            [convId]: { ...(s.readByConv[convId] ?? {}), [userId]: messageId },
          },
        }));
        break;
      }
      case "conversation.updated": {
        get().loadConversations();
        break;
      }
    }
  },
}));
