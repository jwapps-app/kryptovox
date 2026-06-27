import { useEffect, useRef } from "react";
import { getAccessToken } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
import { useCalls } from "../store/calls";
import { CALLS_ENABLED } from "../lib/features";
import type { WsEvent } from "../lib/types";

let activeSocket: WebSocket | null = null;

// Connects once the user is authed. Reconnects with exponential backoff.
// Same-origin: the dev server / nginx proxy /api/ws to the backend.
export function useWebSocket(): void {
  const status = useAuth((s) => s.status);
  const handleWsEvent = useChat((s) => s.handleWsEvent);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    if (status !== "authed") return;
    closedRef.current = false;

    const connect = () => {
      const token = getAccessToken();
      if (!token) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/ws?token=${token}`);
      activeSocket = ws;

      let heartbeat: ReturnType<typeof setInterval> | undefined;
      ws.onopen = () => {
        attemptRef.current = 0;
        // Heartbeat keeps presence "online" — but only while the app is
        // foreground, so a hidden tab is treated as offline and gets pushed.
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && !document.hidden) {
            ws.send(JSON.stringify({ type: "ping", payload: {} }));
          }
        }, 30000);
        // Reflect current visibility immediately on connect.
        ws.send(
          JSON.stringify({
            type: document.hidden ? "presence.away" : "presence.active",
            payload: {},
          })
        );
      };
      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as WsEvent;
          // Call signaling is routed to the (isolated) calls store.
          if (CALLS_ENABLED && typeof event.type === "string" && event.type.startsWith("call.")) {
            void useCalls.getState().onSignal(event);
            return;
          }
          void handleWsEvent(event);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        // If this socket was already superseded (e.g. StrictMode remount opened
        // a newer one), don't null it or schedule a reconnect — that would
        // leave two live sockets delivering every event twice.
        if (activeSocket !== ws) return;
        activeSocket = null;
        if (closedRef.current) return;
        const delay = Math.min(1000 * 2 ** attemptRef.current, 30000);
        attemptRef.current += 1;
        setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();

    // Tell the server when we background/foreground so push targets a hidden
    // tab (the socket stays connected, so disconnect alone wouldn't catch it).
    const onVisibility = () => {
      if (activeSocket?.readyState === WebSocket.OPEN) {
        activeSocket.send(
          JSON.stringify({
            type: document.hidden ? "presence.away" : "presence.active",
            payload: {},
          })
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      closedRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      activeSocket?.close();
      activeSocket = null;
    };
  }, [status, handleWsEvent]);
}

// Best-effort typing signal over the live socket.
export function sendTyping(conversationId: string, typing: boolean): void {
  if (activeSocket?.readyState === WebSocket.OPEN) {
    activeSocket.send(
      JSON.stringify({
        type: typing ? "typing.start" : "typing.stop",
        payload: { conversation_id: conversationId },
      })
    );
  }
}

// Generic best-effort sender over the live socket (used by call signaling).
export function sendWs(type: string, payload: Record<string, unknown>): boolean {
  if (activeSocket?.readyState === WebSocket.OPEN) {
    activeSocket.send(JSON.stringify({ type, payload }));
    return true;
  }
  return false;
}
