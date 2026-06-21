export interface User {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_admin?: boolean;
  identity_public_key?: string | null;
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
  ciphertext: string;
  iv: string;
  created_at: string;
}

export interface GuestThreadSummary {
  id: string;
  created_at: string;
  last_message_at: string;
  expires_at: string | null;
  wrapped_key: string;
  label_ciphertext: string | null;
  label_iv: string | null;
  last: GuestMessage | null;
}

export interface GuestThreadDetail {
  id: string;
  created_at: string;
  expires_at: string | null;
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
}

// WebSocket envelope
export interface WsEvent<T = unknown> {
  type: string;
  payload: T;
}
