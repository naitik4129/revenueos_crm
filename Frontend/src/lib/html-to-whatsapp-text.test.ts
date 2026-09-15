import { describe, expect, it } from "vitest";
import { htmlToWhatsAppText } from "./html-to-whatsapp-text";

describe("htmlToWhatsAppText", () => {
  it("expands links to visible WhatsApp URLs", () => {
    expect(
      htmlToWhatsAppText('<p>Please <a href="https://example.com/demo">view demo</a>.</p>'),
    ).toBe("Please view demo: https://example.com/demo.");
  });

  it("keeps a link URL only once when the link text already matches the URL", () => {
    expect(
      htmlToWhatsAppText('<p><a href="https://example.com/demo">https://example.com/demo</a></p>'),
    ).toBe("https://example.com/demo");
  });

  it("strips unsafe link hrefs but keeps their label text", () => {
    expect(htmlToWhatsAppText('<p><a href="javascript:alert(1)">Open this</a></p>')).toBe(
      "Open this",
    );
  });
});

it("preserves ordered starts and nested mixed lists", () => {
  expect(
    htmlToWhatsAppText(
      '<ol start="3"><li><p>Third</p><ul><li><p>Child</p></li></ul></li><li><p>Fourth</p></li></ol>',
    ),
  ).toBe("3. Third\n  - Child\n4. Fourth");
});
