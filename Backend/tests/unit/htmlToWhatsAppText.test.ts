import { describe, expect, it } from "vitest";
import { htmlToWhatsAppText } from "../../src/domain/htmlToWhatsAppText.js";

describe("htmlToWhatsAppText", () => {
  it("converts bold and italic to WhatsApp markup", () => {
    expect(htmlToWhatsAppText("<p>Hi <strong>Asha</strong>, <em>welcome</em>!</p>")).toBe("Hi *Asha*, _welcome_!");
  });

  it("drops underline but keeps the inner text", () => {
    expect(htmlToWhatsAppText("<p>Please <u>confirm</u> today.</p>")).toBe("Please confirm today.");
  });

  it("converts <br> to a single newline", () => {
    expect(htmlToWhatsAppText("<p>Line one<br>Line two</p>")).toBe("Line one\nLine two");
  });

  it("separates paragraphs with a blank line", () => {
    expect(htmlToWhatsAppText("<p>First para</p><p>Second para</p>")).toBe("First para\n\nSecond para");
  });

  it("converts bullet list items to '- ' prefixed lines", () => {
    expect(htmlToWhatsAppText("<ul><li>One</li><li>Two</li></ul>")).toBe("- One\n- Two");
  });

  it("converts numbered list items to '- ' prefixed lines (no native numbering)", () => {
    expect(htmlToWhatsAppText("<ol><li>First</li><li>Second</li></ol>")).toBe("- First\n- Second");
  });

  it("decodes HTML entities", () => {
    expect(htmlToWhatsAppText("<p>Tom &amp; Jerry say &quot;hi&quot;</p>")).toBe('Tom & Jerry say "hi"');
  });

  it("strips unexpected/legacy tags defensively", () => {
    expect(htmlToWhatsAppText('<div class="x"><span>Hello</span></div>')).toBe("Hello");
  });

  it("handles mixed formatting and lists together", () => {
    const html = "<p>Hi <strong>Asha</strong>,</p><p>Next steps:</p><ul><li><em>Review</em> the doc</li><li>Reply here</li></ul>";
    expect(htmlToWhatsAppText(html)).toBe("Hi *Asha*,\n\nNext steps:\n\n- _Review_ the doc\n- Reply here");
  });
});
