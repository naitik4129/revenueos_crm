/**
 * Preview-only port of Backend/src/domain/htmlToWhatsAppText.ts — used to show
 * what a WhatsApp template will look like once sent. Keep both in sync by
 * hand; the backend copy is the one that actually runs at send time.
 */
export function htmlToWhatsAppText(html: string): string {
  let text = html;

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

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");

  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
