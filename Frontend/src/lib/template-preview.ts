// Same token shape as Backend/src/domain/templateRenderer.ts. After a preview render, any
// `{{...}}` still in the text is one the backend did not fill.
const TOKEN = /(\{\{\s*[\w.]+\s*\}\})/;

const MARK_STYLE = "background:#fde68a;color:#78350f;border-radius:2px;padding:0 2px";

/** Splits text into plain parts and `{{token}}` parts, in order. */
export function splitTokens(text: string): { text: string; token: boolean }[] {
  return text
    .split(TOKEN)
    .filter(Boolean)
    .map((part) => ({ text: part, token: TOKEN.test(part) }));
}

/**
 * Wraps each `{{token}}` in the HTML's text in a highlighted <mark>. Only text nodes are touched,
 * so a token inside an attribute never breaks the markup.
 */
export function markTokensHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parts = splitTokens(node.data);
    if (!parts.some((part) => part.token)) continue;
    const fragment = doc.createDocumentFragment();
    for (const part of parts) {
      if (!part.token) {
        fragment.append(part.text);
        continue;
      }
      const mark = doc.createElement("mark");
      mark.setAttribute("style", MARK_STYLE);
      mark.textContent = part.text;
      fragment.append(mark);
    }
    node.replaceWith(fragment);
  }
  return doc.documentElement.outerHTML;
}
