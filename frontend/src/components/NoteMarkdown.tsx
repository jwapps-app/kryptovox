import { useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";

// Renders a note's markdown read-only. Task checkboxes are interactive: clicking
// one calls onToggle with its index (the source is the single source of truth,
// so we prevent the native toggle and let a re-render reflect the change).
export default function NoteMarkdown({
  source,
  onToggle,
}: {
  source: string;
  onToggle: (index: number) => void;
}) {
  const html = useMemo(() => renderMarkdown(source), [source]);

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" && t.dataset.check != null) {
      e.preventDefault();
      onToggle(Number(t.dataset.check));
    }
  };

  return (
    <div
      className="kv-md kv-scroll flex-1 overflow-y-auto pb-6 text-[17px] leading-snug"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
