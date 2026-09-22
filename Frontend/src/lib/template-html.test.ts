import { describe, expect, it } from "vitest";
import {
  emailPreviewDocument,
  isTemplateBodyEmpty,
  needsHtmlMode,
  normalizeLegacyBody,
  sanitizeEmailHtml,
  templateSummary,
} from "./template-html";

describe("template HTML", () => {
  it("detects designs without classifying basic editor content as custom", () => {
    expect(
      needsHtmlMode('<p>Hello <strong>there</strong></p><ol start="3"><li><p>Item</p></li></ol>'),
    ).toBe(false);
    expect(needsHtmlMode('<table><tr><td style="color:red">Hello</td></tr></table>')).toBe(true);
    expect(needsHtmlMode('<p class="design">Hello</p>')).toBe(true);
    expect(needsHtmlMode("<style>p { color:red }</style><p>Hello</p>")).toBe(true);
  });
  it("handles legacy text, entities, styles and image-only templates", () => {
    expect(normalizeLegacyBody("A < B\nC & D")).toBe("A &lt; B<br>C &amp; D");
    expect(isTemplateBodyEmpty("<style>p{color:red}</style><p>&nbsp;</p>")).toBe(true);
    expect(isTemplateBodyEmpty('<img src="https://example.com/banner.png">')).toBe(false);
    expect(templateSummary("<style>p{color:red}</style><p>A &amp; B</p><p>C</p>")).toBe("A & B C");
  });
  it("isolates preview without altering source styles or placeholders", () => {
    const source =
      '<html><head><style>body{background:red}</style></head><body><script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://example.com"><iframe src="https://example.com"></iframe><a href="https://example.com" onclick="alert(1)">{{lead.firstName}}</a><img src="https://example.com/a.png"></body></html>';
    const preview = emailPreviewDocument(source);
    expect(preview).toContain("body{background:red}");
    expect(preview).toContain("{{lead.firstName}}");
    expect(preview).toContain("Content-Security-Policy");
    expect(preview).not.toMatch(/<script|<iframe|onclick=|href=|http-equiv="refresh"/);
    expect(source).toContain("<script>");
  });
  it("lets pasted base64 images through the preview's image policy", () => {
    const preview = emailPreviewDocument('<img src="data:image/png;base64,AAAA">');
    expect(preview).toContain("img-src https: data:");
    expect(preview).toContain('src="data:image/png;base64,AAAA"');
  });
  it("sanitizes only genuinely dangerous markup, preserving tables, styles and images", () => {
    const fragment =
      '<table><tr><td style="color:red" colspan="2"><img src="data:image/png;base64,AAAA" width="10"></td></tr></table>' +
      '<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">bad</a>' +
      '<a href="https://example.com">ok</a>';
    const cleaned = sanitizeEmailHtml(fragment);
    expect(cleaned).toContain('<td style="color:red" colspan="2">');
    expect(cleaned).toContain('<img src="data:image/png;base64,AAAA" width="10">');
    expect(cleaned).toContain('<a href="https://example.com">ok</a>');
    expect(cleaned).not.toMatch(/<script|onclick=|javascript:/);

    const fullDocument =
      "<!doctype html><html><head><style>body{color:red}</style>" +
      '<meta http-equiv="refresh" content="0;url=https://evil.example"></head>' +
      '<body><iframe src="https://evil.example"></iframe><p>Hi</p></body></html>';
    const cleanedDoc = sanitizeEmailHtml(fullDocument);
    expect(cleanedDoc).toContain("body{color:red}");
    expect(cleanedDoc).toContain("<p>Hi</p>");
    expect(cleanedDoc).not.toMatch(/<iframe|http-equiv="refresh"/);
  });
});
