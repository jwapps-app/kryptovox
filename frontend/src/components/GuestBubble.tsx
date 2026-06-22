import { clockTime } from "../lib/format";
import { mapsUrl } from "../lib/prefs";
import type { Decoded } from "../lib/types";

// Renders one decrypted secret-link message (text / location / image). Shared by
// the guest page and the creator's thread view.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GuestBubble({
  msg,
  mine,
  thumbUrl,
  onOpenImage,
  onOpenFile,
}: {
  msg: Decoded;
  mine: boolean;
  thumbUrl?: string | null;
  onOpenImage?: () => void;
  onOpenFile?: () => void;
}) {
  const radius = mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px";
  const bg = mine ? "#007AFF" : "var(--bubble-in-bg)";
  const color = mine ? "#ffffff" : "var(--bubble-in-text)";

  let location: { lat: number; lng: number; acc: number } | null = null;
  if (msg.type === "location") {
    try {
      location = JSON.parse(msg.text);
    } catch {
      /* fall back to a label */
    }
  }

  return (
    <div className={`mb-3 flex flex-col px-3 ${mine ? "items-end" : "items-start"}`}>
      {msg.type === "file" && msg.media ? (
        <button
          onClick={onOpenFile}
          className="flex max-w-[78%] items-center gap-3 px-3 py-2.5 text-left"
          style={{ background: bg, color, borderRadius: radius }}
          aria-label="Download file"
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium leading-tight">
              {msg.text || "File"}
            </span>
            <span className="text-xs opacity-80">{formatBytes(msg.media.size)}</span>
          </span>
        </button>
      ) : msg.type === "image" && msg.media ? (
        <button
          onClick={onOpenImage}
          className="block overflow-hidden bg-gray-100"
          style={{ width: "min(72%, 250px)", borderRadius: radius }}
          aria-label="Open photo"
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt="Photo"
              className="block w-full"
              style={{ aspectRatio: `${msg.media.w} / ${msg.media.h}` }}
            />
          ) : (
            <div
              className="flex items-center justify-center text-sm text-gray-400"
              style={{ aspectRatio: `${msg.media.w} / ${msg.media.h}` }}
            >
              Loading…
            </div>
          )}
        </button>
      ) : location ? (
        <a
          href={mapsUrl(location.lat, location.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="block max-w-[78%] px-3 py-2.5"
          style={{ background: bg, color, borderRadius: radius }}
        >
          <div className="flex items-center gap-2.5">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div className="min-w-0">
              <div className="text-[15px] font-medium leading-tight">Shared location</div>
              <div className="text-xs opacity-80">
                ±{Math.round(location.acc)} m · Open in Maps
              </div>
            </div>
          </div>
        </a>
      ) : (
        <div
          className="max-w-[75%] whitespace-pre-wrap break-words px-3 py-2 text-[17px] leading-snug"
          style={{ background: bg, color, borderRadius: radius }}
        >
          {msg.text}
        </div>
      )}
      <div className="mt-0.5 px-1 text-[11px] text-gray-400">{clockTime(msg.created_at)}</div>
    </div>
  );
}
