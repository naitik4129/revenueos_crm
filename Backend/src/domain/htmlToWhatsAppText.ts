/**
 * Converts a template's rendered HTML body (see templateRenderer.ts) into
 * WhatsApp's plain-text markup for BaileysManager.performSend. The input is
 * always produced by our own constrained rich-text editor schema — paragraph,
 * hardBreak, bold, italic, underline, bulletList/orderedList — never
 * arbitrary web HTML, so a small hand-written pass is enough; no HTML-parser
 * dependency is needed.
 *
 * Mapping:
 *   <strong>/<b>   -> *text*
 *   <em>/<i>       -> _text_
 *   <u>            -> unwrapped (WhatsApp has no underline markup)
 *   <li>           -> "- " prefixed line (both bullet and numbered lists —
 *                     WhatsApp has no native ordered-list markup)
 *   <br>           -> newline
 *   </p><p>        -> blank line between paragraphs
 *   HTML entities  -> decoded to literal characters (done last)
 *   any other tag  -> stripped defensively
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
  // Every paragraph ends with a blank line, so consecutive paragraphs and a
  // paragraph followed by a list both end up correctly separated.
  text = text.replace(/<p(?:\s[^>]*)?>/gi, "");
  text = text.replace(/<\/p>/gi, "\n\n");

  // Defensively strip any tag left over from an unexpected/legacy shape.
  text = text.replace(/<[^>]+>/g, "");

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");

  // Collapse runs of 3+ newlines (e.g. a paragraph immediately followed by a
  // list) down to a single blank line.
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
