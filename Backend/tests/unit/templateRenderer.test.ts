import { describe, expect, it } from "vitest";
import { findUnknownTemplateTokens, renderTemplate, type TemplateRenderLead } from "../../src/domain/templateRenderer.js";

const lead: TemplateRenderLead = {
  firstName: "Asha",
  lastName: "Rao",
  company: "Rao Textiles",
  email: "asha@raotextiles.example",
  phone: "+919876543210",
  ownerName: "Priya Singh",
};

describe("renderTemplate", () => {
  it("substitutes known lead/owner tokens in body and subject", () => {
    const result = renderTemplate(
      { subject: "Hi {{lead.firstName}}", body: "Hello {{lead.fullName}} from {{lead.company}}, regards {{owner.name}}." },
      lead,
    );
    expect(result.subject).toBe("Hi Asha");
    expect(result.body).toBe("Hello Asha Rao from Rao Textiles, regards Priya Singh.");
    expect(result.unknownTokens).toEqual([]);
  });

  it("falls back lead.fullName to firstName when lastName is empty", () => {
    const result = renderTemplate({ subject: null, body: "{{lead.fullName}}" }, { ...lead, lastName: "" });
    expect(result.body).toBe("Asha");
  });

  it("renders missing email/phone as empty string rather than throwing", () => {
    const result = renderTemplate({ subject: null, body: "{{lead.email}} {{lead.phone}}" }, { ...lead, email: null, phone: null });
    expect(result.body).toBe(" ");
  });

  it("leaves unknown tokens as literal text and reports them", () => {
    const result = renderTemplate({ subject: null, body: "Hi {{lead.firstName}}, ref {{lead.nickname}}." }, lead);
    expect(result.body).toBe("Hi Asha, ref {{lead.nickname}}.");
    expect(result.unknownTokens).toEqual(["lead.nickname"]);
  });
});

describe("findUnknownTemplateTokens", () => {
  it("returns nothing for text using only known variables", () => {
    expect(findUnknownTemplateTokens("Hi {{lead.firstName}}, from {{owner.name}}")).toEqual([]);
  });

  it("flags unrecognized tokens without needing a lead to render against", () => {
    expect(findUnknownTemplateTokens("Hi {{lead.firstName}}, {{lead.birthday}}")).toEqual(["lead.birthday"]);
  });

  it("de-duplicates repeated unknown tokens", () => {
    expect(findUnknownTemplateTokens("{{lead.x}} and {{lead.x}} again")).toEqual(["lead.x"]);
  });
});
