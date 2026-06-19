import { initials } from "../lib/format";

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
}: {
  name: string;
  size?: number;
}) {
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
