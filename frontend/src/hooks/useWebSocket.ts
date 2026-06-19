import { useEffect, useRef } from "react";
import { getAccessToken } from "../lib/api";
import { useAuth } from "../store/auth";
import { useChat } from "../store/chat";
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
        // Refresh server-side presence so offline-push targeting stays accurate.
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", payload: {} }));
          }
        }, 30000);
      };
      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as WsEvent;
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

    return () => {
      closedRef.current = true;
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
