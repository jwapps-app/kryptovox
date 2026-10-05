// WebSocket handshakes can't carry an Authorization header, so the server
// issues a 30-second single-use ticket in exchange for the bearer; the socket
// URL carries the ticket (spent on first use) and never the access token, so
// access logs along the path hold nothing reusable.
import { api } from "./api";

export async function fetchWsTicket(): Promise<string | null> {
  try {
    const r = await api<{ ticket: string }>("/auth/ws-ticket", { method: "POST" });
    return r.ticket;
  } catch {
    return null;
  }
}
