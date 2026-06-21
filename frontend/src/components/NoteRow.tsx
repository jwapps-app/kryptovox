import { useRef, useState } from "react";
import { relativeTime } from "../lib/format";

const REVEAL = 84; // px of Delete exposed by a full swipe

// A note list row. Swipe left → Delete; tap → open.
export default function NoteRow({
  title,
  updatedAt,
  onOpen,
  onDelete,
}: {
  title: string;
  updatedAt: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [dx, setDx] = useState(0);
  const startX = useRef(0);
  const startDx = useRef(0);
  const moved = useRef(false);
  const close = () => setDx(0);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startDx.current = dx;
    moved.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientX - startX.current;
    if (Math.abs(delta) > 8) moved.current = true;
    setDx(Math.max(-REVEAL, Math.min(0, startDx.current + delta))); // left only
  };
  const onTouchEnd = () => setDx(dx < -REVEAL / 2 ? -REVEAL : 0);

  const onClickRow = () => {
    if (moved.current) {
      moved.current = false;
      return; // it was a swipe, not a tap
    }
    if (dx !== 0) {
      close(); // tapping an open row closes it
      return;
    }
    onOpen();
  };

  const snapped = dx === 0 || dx === -REVEAL;

  return (
    <li className="kv-row relative overflow-hidden border-b border-gray-50">
      <button
        onClick={onDelete}
        aria-label="Delete note"
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500 text-sm font-medium text-white"
        style={{ width: REVEAL }}
      >
        Delete
      </button>

      <div
        className="relative z-10 bg-white"
        style={{
          transform: `translateX(${dx}px)`,
          transition: snapped ? "transform 0.2s ease" : "none",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
          onClick={onClickRow}
        >
          <span className={`truncate font-medium ${title ? "" : "text-gray-400"}`}>
            {title || "Untitled note"}
          </span>
          <span className="shrink-0 text-xs text-gray-400">{relativeTime(updatedAt)}</span>
        </button>
      </div>
    </li>
  );
}
