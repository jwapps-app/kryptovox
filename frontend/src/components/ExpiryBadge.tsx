import { useEffect, useState } from "react";

function format(
  expiresAt: string | null,
  burnMinutes: number | null | undefined,
  now: number
): string {
  if (!expiresAt) {
    if (burnMinutes) return `Burns ${burnMinutes} min after opening`;
    return "";
  }
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return "Expired";
  const s = Math.floor(ms / 1000);
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `Expires in ${m}:${String(s % 60).padStart(2, "0")}`;
  }
  const h = Math.floor(s / 3600);
  if (h < 24) return `Expires in ${h}h ${Math.floor((s % 3600) / 60)}m`;
  const d = Math.floor(h / 24);
  return `Expires in ${d} day${d === 1 ? "" : "s"}`;
}

// Live expiry/countdown for a secret link. Ticks every second (the formatting
// shows seconds only inside the last hour).
export default function ExpiryBadge({
  expiresAt,
  burnMinutes,
  className,
}: {
  expiresAt: string | null;
  burnMinutes?: number | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const text = format(expiresAt, burnMinutes, now);
  if (!text) return null;
  return <span className={className}>{text}</span>;
}
