import LinkExtension from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { generateHTML, generateJSON } from "@tiptap/react";
import { normalizeLegacyBody } from "./template-html";

export const LINK_STYLE = "color: #2563eb;";

export function normalizeHttpUrl(value: string): string | null {
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

export const templateEditorExtensions = [
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
];

export function convertToVisualHtml(value: string): string {
  return generateHTML(
    generateJSON(normalizeLegacyBody(value), templateEditorExtensions),
    templateEditorExtensions,
  );
}
