import { create } from "zustand";
import { sendWs } from "../hooks/useWebSocket";
import { useAuth } from "./auth";
import type { WsEvent } from "../lib/types";

// STUN only for now (no TURN relay): direct peer-to-peer connection. Calls on
// restrictive networks may fail to connect until a TURN server is added.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export type CallStatus =
  | "idle"
  | "calling" // we dialed, awaiting answer
  | "incoming" // someone is calling us
  | "connecting" // answered, negotiating
  | "connected";

interface CallState {
  status: CallStatus;
  peerId: string | null;
  peerName: string;
  conversationId: string | null;
  withVideo: boolean;
  muted: boolean;
  cameraOff: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  // Doorbell for an incoming secret-link call when we're not on the thread page
  // (delivered over the main socket); the banner uses it to offer "Answer".
  linkRing: { threadId: string; name: string } | null;
  startCall: (
    conversationId: string,
    peerId: string,
    peerName: string,
    video: boolean,
    selfName?: string
  ) => Promise<void>;
  dismissLinkRing: () => void;
  accept: () => Promise<void>;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  onSignal: (event: WsEvent) => Promise<void>;
}

// Non-serializable connection state lives outside the store.
let pc: RTCPeerConnection | null = null;
let pendingOffer: RTCSessionDescriptionInit | null = null;
let pendingCandidates: RTCIceCandidateInit[] = [];

// Signaling transport is pluggable: 1:1 calls go over the authenticated main
// socket addressed to a peer; secret-link calls go over the thread socket (set
// via setCallTransport). `data` is the call-specific payload (sdp/candidate/etc).
type CallTransport = (type: string, data: Record<string, unknown>) => void;
let activeTransport: CallTransport | null = null;

export function setCallTransport(t: CallTransport | null): void {
  activeTransport = t;
}

function defaultTransport(type: string, data: Record<string, unknown>): void {
  const { peerId, conversationId } = useCalls.getState();
  if (peerId && conversationId) {
    sendWs(type, { to: peerId, conversation_id: conversationId, ...data });
  }
}

function signal(type: string, data: Record<string, unknown> = {}): void {
  (activeTransport ?? defaultTransport)(type, data);
}

function newPeer(): RTCPeerConnection {
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer.onicecandidate = (e) => {
    if (e.candidate) signal("call.ice", { candidate: e.candidate.toJSON() });
  };
  peer.ontrack = (e) => useCalls.setState({ remoteStream: e.streams[0] ?? null });
  peer.onconnectionstatechange = () => {
    const st = peer.connectionState;
    if (st === "connected") useCalls.setState({ status: "connected" });
    else if (st === "failed" || st === "closed") reset();
  };
  return peer;
}

async function flushCandidates(): Promise<void> {
  if (!pc) return;
  for (const c of pendingCandidates) {
    try {
      await pc.addIceCandidate(c);
    } catch {
      /* ignore */
    }
  }
  pendingCandidates = [];
}

function teardown(): void {
  useCalls.getState().localStream?.getTracks().forEach((t) => t.stop());
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* ignore */
    }
    pc = null;
  }
  pendingOffer = null;
  pendingCandidates = [];
}

function reset(): void {
  teardown();
  activeTransport = null; // back to the default (main-socket) transport
  useCalls.setState({
    status: "idle",
    peerId: null,
    peerName: "",
    conversationId: null,
    withVideo: false,
    muted: false,
    cameraOff: false,
    localStream: null,
    remoteStream: null,
  });
}

export const useCalls = create<CallState>((set, get) => ({
  status: "idle",
  peerId: null,
  peerName: "",
  conversationId: null,
  withVideo: false,
  muted: false,
  cameraOff: false,
  localStream: null,
  remoteStream: null,
  linkRing: null,

  dismissLinkRing: () => set({ linkRing: null }),

  startCall: async (conversationId, peerId, peerName, video, selfName) => {
    if (get().status !== "idle") return;
    set({
      status: "calling",
      peerId,
      peerName,
      conversationId,
      withVideo: video,
      remoteStream: null,
      linkRing: null,
    });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      set({ localStream: stream });
      pc = newPeer();
      stream.getTracks().forEach((t) => pc!.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const name = selfName || useAuth.getState().user?.display_name || "Someone";
      signal("call.offer", { sdp: offer, video, name });
    } catch {
      alert("Couldn't start the call — check camera/microphone permission.");
      reset();
    }
  },

  accept: async () => {
    if (get().status !== "incoming" || !pendingOffer) return;
    const { withVideo } = get();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      set({ localStream: stream, status: "connecting" });
      pc = newPeer();
      stream.getTracks().forEach((t) => pc!.addTrack(t, stream));
      await pc.setRemoteDescription(pendingOffer);
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal("call.answer", { sdp: answer });
      pendingOffer = null;
    } catch {
      alert("Couldn't answer — check camera/microphone permission.");
      get().decline();
    }
  },

  decline: () => {
    signal("call.decline");
    reset();
  },

  hangup: () => {
    signal("call.hangup");
    reset();
  },

  toggleMute: () => {
    const { localStream, muted } = get();
    localStream?.getAudioTracks().forEach((t) => (t.enabled = muted));
    set({ muted: !muted });
  },

  toggleCamera: () => {
    const { localStream, cameraOff } = get();
    localStream?.getVideoTracks().forEach((t) => (t.enabled = cameraOff));
    set({ cameraOff: !cameraOff });
  },

  onSignal: async (event) => {
    const p = (event.payload || {}) as Record<string, unknown>;
    switch (event.type) {
      case "call.incoming": {
        // Doorbell over the main socket: a guest is calling on a secret link and
        // we're not on that thread page. Surface a banner unless already busy.
        if (get().status === "idle") {
          set({ linkRing: { threadId: String(p.thread_id), name: String(p.name || "Someone") } });
        }
        return;
      }
      case "call.offer": {
        if (get().status !== "idle") {
          sendWs("call.busy", { to: p.from, conversation_id: p.conversation_id });
          return;
        }
        pendingOffer = p.sdp as RTCSessionDescriptionInit;
        pendingCandidates = [];
        set({
          status: "incoming",
          peerId: String(p.from),
          peerName: (p.name as string) || "Incoming call",
          conversationId: String(p.conversation_id),
          withVideo: !!p.video,
          remoteStream: null,
        });
        signal("call.ringing");
        return;
      }
      case "call.answer": {
        if (pc && p.sdp) {
          await pc.setRemoteDescription(p.sdp as RTCSessionDescriptionInit);
          await flushCandidates();
          set({ status: "connecting" });
        }
        return;
      }
      case "call.ice": {
        const cand = p.candidate as RTCIceCandidateInit | undefined;
        if (!cand) return;
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(cand);
          } catch {
            /* ignore */
          }
        } else {
          pendingCandidates.push(cand);
        }
        return;
      }
      case "call.decline":
      case "call.busy": {
        if (get().status !== "idle") {
          alert(event.type === "call.busy" ? "They’re on another call." : "Call declined.");
          reset();
        }
        return;
      }
      case "call.hangup": {
        if (get().status !== "idle") reset();
        return;
      }
      // call.ringing: no-op for now (could surface a "ringing…" hint).
    }
  },
}));
