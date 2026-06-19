import { create } from "zustand";
import { api, setAccessToken, setOnAuthLost } from "../lib/api";
import { getOrCreateIdentity, loadIdentity } from "../crypto/identity";
import type { StoredIdentity } from "../crypto/identity";
import type { TokenResponse, User } from "../lib/types";

type Status = "loading" | "authed" | "anon";

interface AuthState {
  status: Status;
  user: User | null;
  deviceId: string | null;
  identity: StoredIdentity | null;
  error: string | null;
  bootstrap: () => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName: string,
    deviceName: string
  ) => Promise<void>;
  login: (username: string, password: string, deviceName: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,
  deviceId: null,
  identity: null,
  error: null,

  bootstrap: async () => {
    setOnAuthLost(() => set({ status: "anon", user: null, deviceId: null }));
    const identity = await loadIdentity();
    if (!identity) {
      set({ status: "anon" });
      return;
    }
    try {
      const tok = await api<TokenResponse>("/auth/refresh", { method: "POST" });
      setAccessToken(tok.access_token);
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
    const identity = await getOrCreateIdentity();
    try {
      const tok = await api<TokenResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          display_name: displayName || null,
          device_name: deviceName || null,
          public_key: identity.publicKeyB64,
        }),
      });
      setAccessToken(tok.access_token);
      set({ status: "authed", user: tok.user, deviceId: tok.device_id, identity });
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  login: async (username, password, deviceName) => {
    set({ error: null });
    const identity = await getOrCreateIdentity();
    try {
      const tok = await api<TokenResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          device_name: deviceName || null,
          public_key: identity.publicKeyB64,
        }),
      });
      setAccessToken(tok.access_token);
      set({ status: "authed", user: tok.user, deviceId: tok.device_id, identity });
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  logout: async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    // Keep the device identity in IndexedDB so the same device row is reused.
    set({ status: "anon", user: null, deviceId: null, identity: get().identity });
  },
}));
