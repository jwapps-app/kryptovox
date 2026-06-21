import { useEffect, useState } from "react";
import { initials } from "../lib/format";
import { avatarUrl } from "../lib/avatars";

const COLORS = [
  "#FF3B30",
  "#FF9500",
  "#FFCC00",
  "#34C759",
  "#00C7BE",
  "#30B0C7",
  "#007AFF",
  "#5856D6",
  "#AF52DE",
  "#FF2D55",
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function Avatar({
  name,
  size = 44,
  userId,
  hasAvatar,
}: {
  name: string;
  size?: number;
  userId?: string;
  hasAvatar?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (userId && hasAvatar) {
      void avatarUrl(userId).then((u) => alive && setUrl(u));
    } else {
      setUrl(null);
    }
    return () => {
      alive = false;
    };
  }, [userId, hasAvatar]);

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{
        width: size,
        height: size,
        background: colorFor(name),
        fontSize: size * 0.4,
      }}
    >
      {initials(name)}
    </div>
  );
}
