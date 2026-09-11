import { useEffect, useState, type FormEvent } from "react";
import LinkExtension from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";

const LINK_STYLE = "color: #2563eb;";

/** Existing plain-text rows (pre-rich-text) have no tags at all — turn their line breaks into real <br> so spacing survives once loaded into the editor. */
function normalizeLegacyBody(value: string): string {
  if (value.includes("<")) return value;
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br>");
}

function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function getSelectedText(editor: NonNullable<ReturnType<typeof useEditor>>) {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");

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
      LinkExtension.configure({
        autolink: false,
        openOnClick: false,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          style: LINK_STYLE,
          target: "_blank",
        },
        isAllowedUri: (url) => normalizeHttpUrl(url) !== null,
      }),
    ],
    content: normalizeLegacyBody(value),
    editable: !disabled,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        class:
          "min-h-[150px] max-h-[320px] overflow-y-auto rounded-b-md px-3 py-2 text-sm focus:outline-none [&_a]:text-blue-600 [&_a]:underline",
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

  function syncLinkForm() {
    if (!editor) return;
    const attrs = editor.getAttributes("link") as { href?: string };
    setLinkUrl(attrs.href ?? "");
    setLinkText(getSelectedText(editor));
    setLinkError("");
  }

  function applyLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const normalized = normalizeHttpUrl(linkUrl);
    if (!normalized) {
      setLinkError("Enter a valid http or https link.");
      return;
    }

    const text = linkText.trim();
    const selectedText = getSelectedText(editor);
    if (text && text !== selectedText) {
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent(
          `<a href="${escapeHtml(normalized)}" target="_blank" rel="noopener noreferrer" style="${LINK_STYLE}">${escapeHtml(text)}</a>`,
        )
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    }
    setLinkOpen(false);
  }

  function removeLink() {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  }

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
        <Popover
          open={linkOpen}
          onOpenChange={(open) => {
            setLinkOpen(open);
            if (open) syncLinkForm();
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Insert link"
              aria-pressed={editor.isActive("link")}
              disabled={disabled}
              className={cn(
                "h-7 w-7 p-0",
                editor.isActive("link") && "bg-accent text-accent-foreground",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={syncLinkForm}
            >
              <Link2 className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <form className="space-y-3" onSubmit={applyLink}>
              <div className="space-y-1.5">
                <Label htmlFor="template-link-url" className="text-xs">
                  Link
                </Label>
                <Input
                  id="template-link-url"
                  value={linkUrl}
                  onChange={(event) => {
                    setLinkUrl(event.target.value);
                    setLinkError("");
                  }}
                  placeholder="https://example.com"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="template-link-text" className="text-xs">
                  Text
                </Label>
                <Input
                  id="template-link-text"
                  value={linkText}
                  onChange={(event) => setLinkText(event.target.value)}
                  placeholder="Leave blank to link selected text"
                  className="h-8 text-xs"
                />
              </div>
              {linkError && <p className="text-xs text-destructive">{linkError}</p>}
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!editor.isActive("link")}
                  onClick={removeLink}
                >
                  <Unlink className="size-3.5" />
                  Remove
                </Button>
                <Button type="submit" size="sm">
                  Insert
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
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
