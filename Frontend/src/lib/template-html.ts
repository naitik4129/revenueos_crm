export function normalizeLegacyBody(value: string): string {
  if (/<\/?[a-z][\s\S]*>/i.test(value)) return value;
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function parse(value: string) {
  return new DOMParser().parseFromString(normalizeLegacyBody(value), "text/html");
}

export function templateSummary(value: string): string {
  const doc = parse(value);
  doc.querySelectorAll("script,style,template,iframe,object").forEach((node) => node.remove());
  doc.querySelectorAll("p,li,div,br,td,tr").forEach((node) => node.append(" "));
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function isTemplateBodyEmpty(value: string): boolean {
  return !templateSummary(value) && !parse(value).body.querySelector("img[src]");
}

/** Conservative detection: unfamiliar markup must never be silently serialized by Tiptap. */
export function needsHtmlMode(value: string): boolean {
  if (/<!doctype|<\/?(?:html|head|body)\b|<!--/i.test(value)) return true;
  const doc = parse(value);
  const allowed: Record<string, string[]> = {
    P: [],
    BR: [],
    STRONG: [],
    B: [],
    EM: [],
    I: [],
    U: [],
    UL: [],
    OL: ["start"],
    LI: [],
    A: ["href", "target", "rel", "style"],
  };
  return Array.from(doc.querySelectorAll("head *, body *")).some((node) => {
    const attrs = allowed[node.tagName];
    if (!attrs) return true;
    return Array.from(node.attributes).some(
      (attr) =>
        !attrs.includes(attr.name) ||
        (attr.name === "style" &&
          !/^color:\s*(?:#2563eb|rgb\(37,\s*99,\s*235\));?\s*$/i.test(attr.value)),
    );
  });
}

/** Preview is a disposable document; the original source is never rewritten. */
export function emailPreviewDocument(value: string): string {
  const doc = parse(value);
  doc
    .querySelectorAll("script,iframe,frame,frameset,object,embed,base,meta,link,form")
    .forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      if (
        /^on/i.test(attr.name) ||
        ["href", "action", "formaction", "srcdoc", "target"].includes(attr.name)
      )
        node.removeAttribute(attr.name);
    });
  });
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
  doc.head.prepend(policy);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
