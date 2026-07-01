// Client for the public secret-link signaling socket (/api/guest-ws/{thread_id}).
// Carries call.* signaling between the host and the anonymous guest. Connect on
// the thread/guest page, disconnect on leave. Self-contained — used only by the
// secret-link call feature.
import { useCalls, setCallTransport } from "../store/calls";
import { CALLS_ENABLED } from "./features";

let sock: WebSocket | null = null;
let curThread: string | null = null;
let activityCb: (() => void) | null = null;

function threadSend(type: string, data: Record<string, unknown>): void {
  if (sock?.readyState === WebSocket.OPEN) {
    sock.send(JSON.stringify({ type, payload: data }));
  }
}

/** Route this call's signaling over the thread socket (for an outgoing call). */
export function armThreadTransport(): void {
  setCallTransport(threadSend);
}

// onActivity fires on a `thread.activity` event (a new message on the thread) so
// the page can refresh in real time instead of relying on slow polling.
export function connectThreadSocket(
  threadId: string,
  token?: string,
  onActivity?: () => void
): void {
  if (!CALLS_ENABLED) return;
  activityCb = onActivity ?? null;
  if (sock && curThread === threadId && sock.readyState <= WebSocket.OPEN) return;
  disconnectThreadSocket();
  curThread = threadId;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const ws = new WebSocket(`${proto}://${window.location.host}/api/guest-ws/${threadId}${q}`);
  sock = ws;
  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as { type: string; payload: unknown };
      if (typeof event.type === "string" && event.type.startsWith("call.")) {
        setCallTransport(threadSend); // replies go back over this socket
        void useCalls.getState().onSignal(event);
      } else if (event.type === "thread.activity") {
        activityCb?.();
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    if (sock === ws) sock = null;
  };
  ws.onerror = () => ws.close();
}

export function disconnectThreadSocket(): void {
  curThread = null;
  if (sock) {
    sock.onclose = null;
    try {
      sock.close();
    } catch {
      /* ignore */
    }
    sock = null;
  }
}
