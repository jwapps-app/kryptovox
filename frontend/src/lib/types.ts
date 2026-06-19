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
  token_type: string;
  expires_in: number;
  user: User;
  device_id: string;
}

export interface Reaction {
  emoji: string;
  user_id: string;
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

export interface Conversation {
  id: string;
  type: "direct" | "group";
  name: string | null;
  avatar_url: string | null;
  members: User[];
  my_role: string;
  last_message: Message | null;
  unread_count: number;
}

// WebSocket envelope
export interface WsEvent<T = unknown> {
  type: string;
  payload: T;
}
