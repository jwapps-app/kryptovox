export interface User {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_admin?: boolean;
  identity_public_key?: string | null;
  has_avatar?: boolean;
  twofa_enabled?: boolean;
  has_recovery?: boolean;
}

export interface AdminUser {
  id: string;
  username: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface Device {
  id: string;
  device_name: string | null;
  public_key: string;
  last_seen: string | null;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
  device_id: string;
}

export interface LoginResponse {
  twofa_required: boolean;
  pending_token: string | null;
  methods?: string[];
  tokens: TokenResponse | null;
}

export interface Reaction {
  emoji: string;
  user_id: string;
}

export interface ImageMedia {
  id: string;
  iv: string;
  thumb: string;
  thumb_iv: string;
  w: number;
  h: number;
  mime: string;
  size: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_device_id: string | null;
  ciphertext: string;
  iv: string;
  encrypted_keys: Record<string, string>;
  type: string;
  media: ImageMedia | null;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  disappear_seconds: number; // per-message window, 0 = permanent
  disappear_started_at: string | null; // set on recipient's first read
  created_at: string;
  reactions: Reaction[];
}

export interface MessagePage {
  messages: Message[];
  next_cursor: string | null;
}

// Secret-link guest threads
export interface GuestMessage {
  id: string;
  sender: "host" | "guest";
  type: string;
  ciphertext: string;
  iv: string;
  media: ImageMedia | null;
  created_at: string;
}

// A decrypted guest-thread message, ready to render.
export interface Decoded {
  id: string;
  sender: "host" | "guest";
  type: string; // "text" | "location" | "image"
  text: string; // plaintext, or JSON for location
  media: ImageMedia | null;
  created_at: string;
}

export interface GuestThreadSummary {
  id: string;
  created_at: string;
  last_message_at: string;
  expires_at: string | null;
  burn_minutes: number | null;
  wrapped_key: string;
  label_ciphertext: string | null;
  label_iv: string | null;
  unread: boolean;
  last: GuestMessage | null;
}

export interface GuestThreadDetail {
  id: string;
  created_at: string;
  expires_at: string | null;
  burn_minutes: number | null;
  wrapped_key: string;
  label_ciphertext: string | null;
  label_iv: string | null;
  messages: GuestMessage[];
}

export interface PublicThread {
  id: string;
  created_at: string;
  expires_at: string | null;
  messages: GuestMessage[];
}

export interface Conversation {
  id: string;
  type: "direct" | "group";
  name: string | null;
  avatar_url: string | null;
  members: User[];
  my_role: string;
  last_message: Message | null;
  unread_count: number;
  retention_days: number | null; // null = inherit global default, 0 = forever
  disappear_seconds: number; // 0 = off
  pinned: boolean;
  muted: boolean;
}

// Private, E2EE notes
export interface NoteListItem {
  id: string;
  wrapped_key: string;
  title_ciphertext: string;
  title_iv: string;
  updated_at: string;
}

export interface NoteAttachment {
  media_id: string;
  name_ciphertext: string;
  name_iv: string;
  iv: string;
  mime: string;
  size: number;
}

export interface Note {
  id: string;
  wrapped_key: string;
  title_ciphertext: string;
  title_iv: string;
  body_ciphertext: string;
  body_iv: string;
  attachments: NoteAttachment[];
  created_at: string;
  updated_at: string;
}

// WebSocket envelope
export interface WsEvent<T = unknown> {
  type: string;
  payload: T;
}
