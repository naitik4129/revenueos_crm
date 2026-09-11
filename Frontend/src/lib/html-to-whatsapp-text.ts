/**
 * Preview-only port of Backend/src/domain/htmlToWhatsAppText.ts — used to show
 * what a WhatsApp template will look like once sent. Keep both in sync by
 * hand; the backend copy is the one that actually runs at send time.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function safeHttpHref(attrs: string): string | null {
  const match = attrs.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const href = decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function htmlToWhatsAppText(html: string): string {
  let text = html;

  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs: string, label: string) => {
    const href = safeHttpHref(attrs);
    if (!href) return label;
    const plainLabel = decodeHtmlEntities(stripTags(label)).trim();
    if (!plainLabel || plainLabel === href) return href;
    return `${label}: ${href}`;
  });

  text = text.replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, "*$2*");
  text = text.replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, "_$2_");
  text = text.replace(/<\/?u(?:\s[^>]*)?>/gi, "");

  text = text.replace(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi, "- $1\n");
  text = text.replace(/<(ul|ol)(?:\s[^>]*)?>/gi, "\n");
  text = text.replace(/<\/(ul|ol)>/gi, "\n");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<p(?:\s[^>]*)?>/gi, "");
  text = text.replace(/<\/p>/gi, "\n\n");

  text = text.replace(/<[^>]+>/g, "");

  text = decodeHtmlEntities(text);

  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
