// Upload/download of encrypted media blobs. Raw binary, so it bypasses the JSON
// api() helper but reuses its access token + one-shot refresh on 401.
import { getAccessToken, refreshToken } from "./api";

async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  const withAuth = (): RequestInit => {
    const headers = new Headers(init.headers);
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers, credentials: "include" };
  };
  let res = await fetch(`/api${path}`, withAuth());
  if (res.status === 401 && (await refreshToken())) {
    res = await fetch(`/api${path}`, withAuth());
  }
  return res;
}

export async function uploadMedia(bytes: Uint8Array): Promise<string> {
  const res = await authedFetch("/media", {
    method: "POST",
    body: new Blob([bytes as BlobPart], { type: "application/octet-stream" }),
  });
  if (!res.ok) throw new Error("Image upload failed");
  return ((await res.json()) as { id: string }).id;
}

export async function fetchMedia(id: string): Promise<Uint8Array> {
  const res = await authedFetch(`/media/${id}`, { method: "GET" });
  if (!res.ok) throw new Error("Image download failed");
  return new Uint8Array(await res.arrayBuffer());
}

// Secret-link thread media. Host side is authenticated (/links); guest side is
// public (/guest) — the blob is E2EE either way, gated by the thread.
const blobBody = (bytes: Uint8Array): Blob =>
  new Blob([bytes as BlobPart], { type: "application/octet-stream" });

export async function uploadThreadMediaHost(threadId: string, bytes: Uint8Array): Promise<string> {
  const res = await authedFetch(`/links/${threadId}/media`, {
    method: "POST",
    body: blobBody(bytes),
  });
  if (!res.ok) throw new Error("Image upload failed");
  return ((await res.json()) as { id: string }).id;
}

export async function fetchThreadMediaHost(threadId: string, id: string): Promise<Uint8Array> {
  const res = await authedFetch(`/links/${threadId}/media/${id}`, { method: "GET" });
  if (!res.ok) throw new Error("Image download failed");
  return new Uint8Array(await res.arrayBuffer());
}

export async function uploadThreadMediaGuest(
  threadId: string,
  bytes: Uint8Array
): Promise<string> {
  const res = await fetch(`/api/guest/${threadId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blobBody(bytes),
  });
  if (!res.ok) throw new Error("Image upload failed");
  return ((await res.json()) as { id: string }).id;
}

export async function fetchThreadMediaGuest(threadId: string, id: string): Promise<Uint8Array> {
  const res = await fetch(`/api/guest/${threadId}/media/${id}`, { method: "GET" });
  if (!res.ok) throw new Error("Image download failed");
  return new Uint8Array(await res.arrayBuffer());
}

// Note attachments (owner-only).
export async function uploadNoteMedia(noteId: string, bytes: Uint8Array): Promise<string> {
  const res = await authedFetch(`/notes/${noteId}/media`, {
    method: "POST",
    body: blobBody(bytes),
  });
  if (!res.ok) throw new Error("Attachment upload failed");
  return ((await res.json()) as { id: string }).id;
}

export async function fetchNoteMedia(noteId: string, id: string): Promise<Uint8Array> {
  const res = await authedFetch(`/notes/${noteId}/media/${id}`, { method: "GET" });
  if (!res.ok) throw new Error("Attachment download failed");
  return new Uint8Array(await res.arrayBuffer());
}
