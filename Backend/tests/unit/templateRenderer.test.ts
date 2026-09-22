import { describe, expect, it } from "vitest";
import { findUnknownTemplateTokens, renderTemplate, type TemplateRenderLead, type TemplateRenderMeeting } from "../../src/domain/templateRenderer.js";

const lead: TemplateRenderLead = {
  firstName: "Asha",
  lastName: "Rao",
  company: "Rao Textiles",
  industry: "Textiles",
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

  it("substitutes lead.industry, falling back to empty string when missing", () => {
    const result = renderTemplate({ subject: null, body: "{{lead.industry}}" }, lead);
    expect(result.body).toBe("Textiles");
    expect(renderTemplate({ subject: null, body: "{{lead.industry}}" }, { ...lead, industry: null }).body).toBe("");
  });

  it("leaves unknown tokens as literal text and reports them", () => {
    const result = renderTemplate({ subject: null, body: "Hi {{lead.firstName}}, ref {{lead.nickname}}." }, lead);
    expect(result.body).toBe("Hi Asha, ref {{lead.nickname}}.");
    expect(result.unknownTokens).toEqual(["lead.nickname"]);
  });

  const meeting: TemplateRenderMeeting = {
    title: "Discovery call",
    at: "2030-01-03T09:30:00.000Z",
    durationMin: 45,
    link: "https://meet.google.com/abc-defg-hij",
  };

  it("substitutes meeting tokens when a meeting is provided", () => {
    const result = renderTemplate(
      { subject: null, body: "{{meeting.title}} on {{meeting.date}} at {{meeting.time}} ({{meeting.duration}}): {{meeting.link}}" },
      lead,
      meeting,
    );
    expect(result.body).toContain("Discovery call on");
    expect(result.body).toContain("45 minutes");
    expect(result.body).toContain("https://meet.google.com/abc-defg-hij");
    expect(result.unknownTokens).toEqual([]);
  });

  it.each(["meeting.date", "meeting.time", "meeting.title", "meeting.duration", "meeting.link"])("rejects %s without meeting context in either subject or body", (token) => {
    expect(() => renderTemplate({ subject: null, body: `{{${token}}}` }, lead)).toThrow("require a scheduled meeting");
    expect(() => renderTemplate({ subject: `{{ ${token} }}`, body: "Hello" }, lead)).toThrow("require a scheduled meeting");
  });

  it.each([
    ["2026-12-31T18:29:00Z", "31 Dec 2026", "1 Jan 2027", "11:59 pm"],
    ["2026-12-31T18:30:00Z", "1 Jan 2027", "2 Jan 2027", "12:00 am"],
    ["2028-02-28T08:00:00Z", "28 Feb 2028", "29 Feb 2028", "1:30 pm"],
  ])("uses IST and handles calendar rollover at %s", (instant, today, tomorrow, time) => {
    const text = "{{current.date}} / {{tomorrow.date}} / {{current.time}}";
    const result = renderTemplate({ subject: text, body: text }, lead, undefined, new Date(instant));
    expect(result.body).toBe(`${today} / ${tomorrow} / ${time}`);
    expect(result.subject).toBe(result.body);
    expect(result.unknownTokens).toEqual([]);
    expect(findUnknownTemplateTokens(text)).toEqual([]);
  });

  it("maps meeting date/time to the meeting instant independently of the send date", () => {
    const result = renderTemplate(
      { subject: "{{meeting.date}} at {{meeting.time}}", body: "Today {{current.date}}; meeting {{meeting.date}} at {{meeting.time}}" },
      lead,
      { ...meeting, at: "2030-01-03T19:00:00Z" },
      new Date("2026-09-08T08:00:00Z"),
    );
    expect(result.subject).toBe("4 Jan 2030 at 12:30 am");
    expect(result.body).toBe("Today 8 Sept 2026; meeting 4 Jan 2030 at 12:30 am");
  });

  it("escapes meeting fields in HTML bodies while retaining plain subject values", () => {
    const result = renderTemplate({ subject: "{{meeting.title}}", body: "{{meeting.title}}" }, lead, { ...meeting, title: "<Call> & chat" });
    expect(result.subject).toBe("<Call> & chat");
    expect(result.body).toBe("&lt;Call&gt; &amp; chat");
  });

  it("renders a null meeting link as empty string rather than throwing", () => {
    const result = renderTemplate({ subject: null, body: "{{meeting.link}}" }, lead, { ...meeting, link: null });
    expect(result.body).toBe("");
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
