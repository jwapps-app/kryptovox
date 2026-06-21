// Minimal, safe Markdown → HTML for notes. Supports headings, bold, italic,
// inline code, bullet/numbered lists, and GFM-style task checkboxes. Input is
// HTML-escaped first, so raw HTML is never injected (no XSS from note content).

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline spans. `s` is already HTML-escaped. Bold first so ** isn't eaten by *.
function inline(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

const TASK_RE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/;
const NUM_RE = /^(\s*)\d+\.\s+(.*)$/;
const HEAD_RE = /^(#{1,3})\s+(.*)$/;

export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let checkIndex = 0;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const openList = (kind: "ul" | "ol", cls = "") => {
    if (list !== kind) {
      closeList();
      out.push(`<${kind}${cls ? ` class="${cls}"` : ""}>`);
      list = kind;
    }
  };

  for (const line of esc(src).split("\n")) {
    const task = line.match(TASK_RE);
    if (task) {
      openList("ul", "kv-tasks");
      const checked = task[2].toLowerCase() === "x";
      out.push(
        `<li class="kv-task"><input type="checkbox" data-check="${checkIndex}"${
          checked ? " checked" : ""
        }/><span${checked ? ' class="kv-done"' : ""}>${inline(task[3])}</span></li>`
      );
      checkIndex++;
      continue;
    }
    const bullet = line.match(BULLET_RE);
    if (bullet) {
      openList("ul");
      out.push(`<li>${inline(bullet[2])}</li>`);
      continue;
    }
    const num = line.match(NUM_RE);
    if (num) {
      openList("ol");
      out.push(`<li>${inline(num[2])}</li>`);
      continue;
    }
    closeList();
    const head = line.match(HEAD_RE);
    if (head) {
      const lvl = head[1].length;
      out.push(`<h${lvl}>${inline(head[2])}</h${lvl}>`);
      continue;
    }
    if (line.trim() === "") {
      out.push("");
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

// Flip the Nth task checkbox in the source markdown (index matches render order).
export function toggleCheckbox(src: string, index: number): string {
  let i = -1;
  return src
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*[-*]\s+)\[([ xX])\](\s+.*)$/);
      if (!m) return line;
      i++;
      if (i !== index) return line;
      const checked = m[2].toLowerCase() === "x";
      return `${m[1]}[${checked ? " " : "x"}]${m[3]}`;
    })
    .join("\n");
}
