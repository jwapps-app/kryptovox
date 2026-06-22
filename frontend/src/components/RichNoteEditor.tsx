import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

// WYSIWYG note body. You type seeing the real formatting; the value is stored as
// markdown (editor.storage.markdown) so it stays one encrypted string and the
// crypto/storage never change. Lists and task checkboxes continue on Enter and
// toggle on click natively.
export default function RichNoteEditor({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (markdown: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false }),
    ],
    content: initial,
    editorProps: {
      attributes: { class: "kv-md kv-rte outline-none min-h-full pb-10" },
    },
    onUpdate: ({ editor }) => {
      const md = (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown();
      onChange(md);
    },
  });

  if (!editor) return <div className="flex-1" />;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="kv-scroll flex-1 overflow-y-auto" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  // preventDefault so tapping a button doesn't blur the editor / lose selection.
  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };
  const cls = (active: boolean) =>
    `flex h-8 w-9 items-center justify-center rounded-lg active:bg-gray-100 ${
      active ? "text-imsg-blue" : "text-gray-500"
    }`;
  const stroke = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <div className="mb-1 flex gap-1 border-b border-gray-100 pb-2">
      <button
        className={`${cls(editor.isActive("bold"))} font-bold`}
        onMouseDown={run(() => editor.chain().focus().toggleBold().run())}
        aria-label="Bold"
      >
        B
      </button>
      <button
        className={`${cls(editor.isActive("italic"))} font-serif italic`}
        onMouseDown={run(() => editor.chain().focus().toggleItalic().run())}
        aria-label="Italic"
      >
        I
      </button>
      <button
        className={`${cls(editor.isActive("heading", { level: 2 }))} font-semibold`}
        onMouseDown={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        aria-label="Heading"
      >
        H
      </button>
      <button
        className={cls(editor.isActive("bulletList"))}
        onMouseDown={run(() => editor.chain().focus().toggleBulletList().run())}
        aria-label="Bulleted list"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4.5" cy="6" r="1" />
          <circle cx="4.5" cy="12" r="1" />
          <circle cx="4.5" cy="18" r="1" />
        </svg>
      </button>
      <button
        className={cls(editor.isActive("orderedList"))}
        onMouseDown={run(() => editor.chain().focus().toggleOrderedList().run())}
        aria-label="Numbered list"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
          <line x1="10" y1="6" x2="20" y2="6" />
          <line x1="10" y1="12" x2="20" y2="12" />
          <line x1="10" y1="18" x2="20" y2="18" />
          <path d="M4 6h1v3M4 12h1.5l-1.5 2h1.5" />
        </svg>
      </button>
      <button
        className={cls(editor.isActive("taskList"))}
        onMouseDown={run(() => editor.chain().focus().toggleTaskList().run())}
        aria-label="Checklist"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
          <polyline points="3 6 4.5 7.5 7 5" />
          <polyline points="3 17 4.5 18.5 7 16" />
          <line x1="11" y1="6" x2="20" y2="6" />
          <line x1="11" y1="17" x2="20" y2="17" />
        </svg>
      </button>
    </div>
  );
}
