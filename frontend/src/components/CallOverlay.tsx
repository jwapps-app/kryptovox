import { useEffect, useRef } from "react";
import { useCalls } from "../store/calls";

// Full-screen call UI. Renders nothing when idle, so it's safe to always mount.
export default function CallOverlay() {
  const status = useCalls((s) => s.status);
  const peerName = useCalls((s) => s.peerName);
  const withVideo = useCalls((s) => s.withVideo);
  const muted = useCalls((s) => s.muted);
  const cameraOff = useCalls((s) => s.cameraOff);
  const localStream = useCalls((s) => s.localStream);
  const remoteStream = useCalls((s) => s.remoteStream);
  const accept = useCalls((s) => s.accept);
  const decline = useCalls((s) => s.decline);
  const hangup = useCalls((s) => s.hangup);
  const toggleMute = useCalls((s) => s.toggleMute);
  const toggleCamera = useCalls((s) => s.toggleCamera);

  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  if (status === "idle") return null;

  const inCall = status === "connecting" || status === "connected";
  const label =
    status === "incoming"
      ? `${peerName} is calling…`
      : status === "calling"
        ? `Calling ${peerName}…`
        : status === "connecting"
          ? "Connecting…"
          : peerName;

  const initial = (peerName || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-gray-900 text-white">
      {/* Remote video plays the audio too; for audio calls it stays black and the
          avatar below covers it. */}
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        className={`absolute inset-0 h-full w-full object-cover ${
          withVideo && status === "connected" ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Local preview (video calls only). Muted so we don't echo ourselves. */}
      {withVideo && (
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="absolute right-3 top-3 z-10 h-40 w-28 rounded-xl border border-white/20 object-cover"
        />
      )}

      {/* Name / status (hidden once a video call is live and showing video). */}
      <div className="z-10 mt-24 flex flex-col items-center gap-4">
        {!(withVideo && status === "connected") && (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/15 text-4xl font-semibold">
            {initial}
          </div>
        )}
        <p className="text-lg font-medium drop-shadow">{label}</p>
      </div>

      {/* Controls */}
      <div className="z-10 mb-16 flex items-center gap-6">
        {status === "incoming" ? (
          <>
            <button
              onClick={() => decline()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-2xl active:opacity-70"
              aria-label="Decline"
            >
              ✕
            </button>
            <button
              onClick={() => void accept()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-2xl active:opacity-70"
              aria-label="Accept"
            >
              ✓
            </button>
          </>
        ) : (
          <>
            {inCall && (
              <button
                onClick={() => toggleMute()}
                className={`flex h-14 w-14 items-center justify-center rounded-full text-sm active:opacity-70 ${
                  muted ? "bg-white text-gray-900" : "bg-white/20"
                }`}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
            )}
            {inCall && withVideo && (
              <button
                onClick={() => toggleCamera()}
                className={`flex h-14 w-14 items-center justify-center rounded-full text-xs active:opacity-70 ${
                  cameraOff ? "bg-white text-gray-900" : "bg-white/20"
                }`}
                aria-label={cameraOff ? "Camera on" : "Camera off"}
              >
                {cameraOff ? "Cam on" : "Cam off"}
              </button>
            )}
            <button
              onClick={() => hangup()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-2xl active:opacity-70"
              aria-label="End call"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
