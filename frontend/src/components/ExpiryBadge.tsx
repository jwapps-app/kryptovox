import { useEffect, useState } from "react";

function duration(s: number): string {
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ${Math.floor((s % 3600) / 60)}m`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

function format(
  expiresAt: string | null,
  burnMinutes: number | null | undefined,
  now: number,
  bare: boolean
): string {
  if (!expiresAt) {
    if (burnMinutes)
      return bare ? `${burnMinutes} min once opened` : `Burns ${burnMinutes} min after opening`;
    return "";
  }
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return bare ? "any moment" : "Expired";
  const d = duration(Math.floor(ms / 1000));
  return bare ? d : `Expires in ${d}`;
}

// Live expiry/countdown for a secret link. Ticks every second (the formatting
// shows seconds only inside the last hour).
export default function ExpiryBadge({
  expiresAt,
  burnMinutes,
  className,
  bare = false,
}: {
  expiresAt: string | null;
  burnMinutes?: number | null;
  className?: string;
  bare?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const text = format(expiresAt, burnMinutes, now, bare);
  if (!text) return null;
  return <span className={className}>{text}</span>;
}
