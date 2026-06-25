import { create } from "zustand";
import { api, setAccessToken, setOnAuthLost } from "../lib/api";
import { getRefreshToken, setRefreshToken } from "../lib/session";
import {
  clearIdentity,
  createIdentity,
  loadIdentity,
  recoverIdentity,
  wrapPrivateKey,
} from "../crypto/identity";
import type { EncryptedKeyBlob, Identity } from "../crypto/identity";
import { verifyPasskeyLogin } from "../lib/passkey";
import type { LoginResponse, TokenResponse, User } from "../lib/types";

type Status = "loading" | "authed" | "anon";

interface IdentityResponse {
  identity_public_key: string | null;
  encrypted_private_key: EncryptedKeyBlob | null;
}

interface AuthState {
  status: Status;
  user: User | null;
  deviceId: string | null;
  identity: Identity | null;
  error: string | null;
  needsReauth: boolean; // valid session but no local key — must re-enter password
  bootstrap: () => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName: string,
    deviceName: string
  ) => Promise<void>;
  login: (
    username: string,
    password: string,
    deviceName: string
  ) => Promise<{ twofaRequired: boolean; pendingToken?: string; methods?: string[] }>;
  complete2fa: (
    pendingToken: string,
    code: string,
    password: string,
    deviceName: string
  ) => Promise<void>;
  complete2faPasskey: (
    pendingToken: string,
    challengeToken: string,
    credential: unknown,
    password: string,
    deviceName: string
  ) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// Recover the user's shared identity, or establish it on first sign-in.
async function ensureIdentity(password: string): Promise<Identity> {
  const remote = await api<IdentityResponse>("/users/me/identity");
  if (remote.identity_public_key && remote.encrypted_private_key) {
    return recoverIdentity(remote.identity_public_key, remote.encrypted_private_key, password);
  }
  // No identity yet — create one and publish it (server keeps the first writer).
  const { identity, blob } = await createIdentity(password);
  const saved = await api<IdentityResponse>("/users/me/identity", {
    method: "PUT",
    body: JSON.stringify({
      identity_public_key: identity.publicKeyB64,
      encrypted_private_key: blob,
    }),
  });
  if (
    saved.identity_public_key &&
    saved.encrypted_private_key &&
    saved.identity_public_key !== identity.publicKeyB64
  ) {
    // Another device won the race — adopt the server's identity.
    return recoverIdentity(saved.identity_public_key, saved.encrypted_private_key, password);
  }
  return identity;
}

// Apply a successful token response: store tokens, recover the identity, go authed.
async function applyTokens(
  set: (partial: Partial<AuthState>) => void,
  tok: TokenResponse,
  password: string
): Promise<void> {
  setAccessToken(tok.access_token);
  setRefreshToken(tok.refresh_token);
  const identity = await ensureIdentity(password);
  set({
    status: "authed",
    user: { ...tok.user, identity_public_key: identity.publicKeyB64 },
    deviceId: tok.device_id,
    identity,
    needsReauth: false,
  });
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,
  deviceId: null,
  identity: null,
  error: null,
  needsReauth: false,

  bootstrap: async () => {
    setOnAuthLost(() =>
      set({ status: "anon", user: null, deviceId: null, needsReauth: false })
    );
    const identity = await loadIdentity();
    try {
      // Retry: on a mobile cold start the first request can fail before the
      // network is ready (ERR_CONNECTION_REFUSED). Don't drop the session on a
      // single transient failure.
      let tok: TokenResponse | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          tok = await api<TokenResponse>("/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refresh_token: getRefreshToken() }),
          });
          break;
        } catch (e) {
          // A real 401 (invalid/expired token) shouldn't be retried.
          if ((e as { status?: number }).status === 401) throw e;
          if (attempt === 3) throw e;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      if (!tok) throw new Error("refresh failed");
      setAccessToken(tok.access_token);
      setRefreshToken(tok.refresh_token);
      if (!identity) {
        // Session is valid but this device has no key — require a password login.
        set({ status: "anon", needsReauth: true });
        return;
      }
      set({
        status: "authed",
        user: tok.user,
        deviceId: tok.device_id,
        identity,
      });
    } catch {
      set({ status: "anon", identity });
    }
  },

  register: async (username, password, displayName, deviceName) => {
    set({ error: null });
    try {
      const { identity, blob } = await createIdentity(password);
      const tok = await api<TokenResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          display_name: displayName || null,
          device_name: deviceName || null,
          identity_public_key: identity.publicKeyB64,
          encrypted_private_key: blob,
        }),
      });
      setAccessToken(tok.access_token);
      setRefreshToken(tok.refresh_token);
      set({
        status: "authed",
        user: tok.user,
        deviceId: tok.device_id,
        identity,
        needsReauth: false,
      });
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  login: async (username, password, deviceName) => {
    set({ error: null });
    try {
      const res = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, device_name: deviceName || null }),
      });
      if (res.twofa_required && res.pending_token) {
        return {
          twofaRequired: true,
          pendingToken: res.pending_token,
          methods: res.methods,
        };
      }
      if (res.tokens) await applyTokens(set, res.tokens, password);
      return { twofaRequired: false };
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  complete2faPasskey: async (pendingToken, challengeToken, credential, password, deviceName) => {
    set({ error: null });
    try {
      const res = await verifyPasskeyLogin(pendingToken, challengeToken, credential, deviceName);
      if (res.tokens) await applyTokens(set, res.tokens, password);
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  complete2fa: async (pendingToken, code, password, deviceName) => {
    set({ error: null });
    try {
      const res = await api<LoginResponse>("/auth/2fa", {
        method: "POST",
        body: JSON.stringify({
          pending_token: pendingToken,
          code,
          device_name: deviceName || null,
        }),
      });
      if (res.tokens) await applyTokens(set, res.tokens, password);
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const identity = get().identity;
    if (!identity) throw new Error("No identity loaded on this device");
    // Re-wrap the identity key under the new password client-side; the server
    // never sees the plaintext key.
    const blob = await wrapPrivateKey(identity.privateKey, newPassword);
    await api("/users/me/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        encrypted_private_key: blob,
      }),
    });
  },

  deleteAccount: async (password) => {
    await api("/users/me", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
    await clearIdentity();
    setAccessToken(null);
    setRefreshToken(null);
    set({ status: "anon", user: null, deviceId: null, identity: null, needsReauth: false });
  },

  logout: async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    setRefreshToken(null);
    set({
      status: "anon",
      user: null,
      deviceId: null,
      identity: get().identity,
      needsReauth: false,
    });
  },
}));
