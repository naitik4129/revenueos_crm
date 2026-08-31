import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";

/** Existing plain-text rows (pre-rich-text) have no tags at all — turn their line breaks into real <br> so spacing survives once loaded into the editor. */
function normalizeLegacyBody(value: string): string {
  if (value.includes("<")) return value;
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br>");
}

export function TemplateBodyEditor({
  value,
  onChange,
  loadKey,
  disabled,
}: {
  value: string;
  onChange: (html: string) => void;
  /** Changes only when a different template is loaded into the dialog — gates the one-time content reset so we don't fight the user's typing on every keystroke. */
  loadKey: string;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        strike: false,
        horizontalRule: false,
        code: false,
        link: false,
      }),
    ],
    content: normalizeLegacyBody(value),
    editable: !disabled,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        class:
          "min-h-[150px] max-h-[320px] overflow-y-auto rounded-b-md px-3 py-2 text-sm focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(normalizeLegacyBody(value));
    // Only re-sync when switching to a different template (loadKey) — not on every value change, since onUpdate above already keeps `value` and the editor's own content in sync as the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, loadKey]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return null;

  const toolbarButton = (
    label: string,
    icon: React.ReactNode,
    active: boolean,
    onClick: () => void,
  ) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn("h-7 w-7 p-0", active && "bg-accent text-accent-foreground")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </Button>
  );

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1">
        {toolbarButton("Bold", <Bold className="size-3.5" />, editor.isActive("bold"), () =>
          editor.chain().focus().toggleBold().run(),
        )}
        {toolbarButton("Italic", <Italic className="size-3.5" />, editor.isActive("italic"), () =>
          editor.chain().focus().toggleItalic().run(),
        )}
        {toolbarButton(
          "Underline",
          <UnderlineIcon className="size-3.5" />,
          editor.isActive("underline"),
          () => editor.chain().focus().toggleUnderline().run(),
        )}
        {toolbarButton(
          "Bullet list",
          <List className="size-3.5" />,
          editor.isActive("bulletList"),
          () => editor.chain().focus().toggleBulletList().run(),
        )}
        {toolbarButton(
          "Numbered list",
          <ListOrdered className="size-3.5" />,
          editor.isActive("orderedList"),
          () => editor.chain().focus().toggleOrderedList().run(),
        )}
        <div className="ml-auto">
          <Select
            disabled={!!disabled}
            value=""
            onValueChange={(token) => editor.chain().focus().insertContent(`{{${token}}}`).run()}
          >
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue placeholder="Insert variable" />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_VARIABLES.map((v) => (
                <SelectItem key={v.token} value={v.token} className="text-xs">
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
