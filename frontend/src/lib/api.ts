// Thin fetch wrapper. Access token lives in memory only (never localStorage);
// the refresh token is an httpOnly cookie the browser sends automatically.
// On a 401 we transparently attempt one refresh + retry.

import type { TokenResponse } from "./types";

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setOnAuthLost(cb: () => void): void {
  onAuthLost = cb;
}

export function getAccessToken(): string | null {
  return accessToken;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function refreshToken(): Promise<boolean> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return false;
  const data = (await res.json()) as TokenResponse;
  accessToken = data.access_token;
  return true;
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`/api${path}`, { ...init, headers, credentials: "include" });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, init);

  if (res.status === 401 && !path.startsWith("/auth/")) {
    if (await refreshToken()) {
      res = await rawRequest(path, init);
    } else {
      accessToken = null;
      onAuthLost?.();
      throw new ApiError(401, "Session expired");
    }
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { ApiError };
