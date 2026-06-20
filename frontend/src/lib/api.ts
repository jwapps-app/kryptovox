// Thin fetch wrapper. The access token lives in memory only; the refresh token
// is persisted in localStorage (see lib/session.ts) so installed PWAs survive a
// force-close, and is sent in the /auth/refresh request body. On a 401 we
// transparently attempt one refresh + retry.

import type { TokenResponse } from "./types";
import { getRefreshToken, setRefreshToken } from "./session";

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

export async function refreshToken(): Promise<boolean> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: getRefreshToken() }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as TokenResponse;
  accessToken = data.access_token;
  if (data.refresh_token) setRefreshToken(data.refresh_token);
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
      // FastAPI errors: detail is a string, or a list of validation objects.
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        detail = body.detail
          .map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d))
          .join("; ");
      } else if (body.detail != null) {
        detail = JSON.stringify(body.detail);
      }
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { ApiError };
