import { describe, expect, it } from "vitest";
import {
  findUnknownTemplateTokens,
  KNOWN_TEMPLATE_VARIABLES,
  previewTemplate,
  renderTemplate,
  type TemplateRenderContext,
  type TemplateRenderMeeting,
} from "../../src/domain/templateRenderer.js";

const asha: TemplateRenderContext = {
  contact: { firstName: "Asha", lastName: "Rao", email: "asha@raotextiles.example", phone: "+919876543210", jobTitle: "Founder" },
  company: { name: "Rao Textiles", industry: "Textiles", website: "https://raotextiles.example" },
  deal: { stage: "meeting_scheduled", serviceInterest: "Outbound SDR team", ownerName: "Priya Singh" },
};

describe("renderTemplate", () => {
  it("substitutes contact, company and deal tokens in body and subject", () => {
    const result = renderTemplate(
      {
        subject: "Hi {{contact.firstName}}",
        body: "Hello {{contact.fullName}} ({{contact.jobTitle}}) at {{company.name}}, {{company.industry}}, {{company.website}}. " +
          "Re: {{deal.serviceInterest}} - {{deal.stage}}. Regards {{deal.ownerName}}, {{contact.email}} {{contact.phone}}",
      },
      asha,
    );
    expect(result.subject).toBe("Hi Asha");
    expect(result.body).toBe(
      "Hello Asha Rao (Founder) at Rao Textiles, Textiles, https://raotextiles.example. Re: Outbound SDR team - meeting scheduled. Regards Priya Singh, asha@raotextiles.example +919876543210",
    );
    expect(result.unknownTokens).toEqual([]);
  });

  it("falls back contact.fullName to firstName when lastName is empty", () => {
    const result = renderTemplate({ subject: null, body: "{{contact.fullName}}" }, { ...asha, contact: { ...asha.contact, lastName: "" } });
    expect(result.body).toBe("Asha");
  });

  it("renders missing values (no company, no email/phone) as empty strings", () => {
    const empty: TemplateRenderContext = {
      contact: { ...asha.contact, email: null, phone: null, jobTitle: null },
      company: { name: null, industry: null, website: null },
      deal: { stage: null, serviceInterest: null, ownerName: null },
    };
    expect(renderTemplate({ subject: null, body: "[{{contact.email}}|{{company.name}}|{{deal.ownerName}}|{{deal.stage}}]" }, empty).body).toBe("[|||]");
  });

  it("escapes values in the HTML body but not in the plain-text subject", () => {
    const ctx = { ...asha, company: { ...asha.company, name: "R&D <Labs>" } };
    const result = renderTemplate({ subject: "{{company.name}}", body: "{{company.name}}" }, ctx);
    expect(result.subject).toBe("R&D <Labs>");
    expect(result.body).toBe("R&amp;D &lt;Labs&gt;");
  });

  it("leaves unknown tokens as literal text and reports them", () => {
    const result = renderTemplate({ subject: null, body: "Hi {{contact.firstName}}, {{contact.nickname}} {{company.size}}." }, asha);
    expect(result.body).toBe("Hi Asha, {{contact.nickname}} {{company.size}}.");
    expect(result.unknownTokens).toEqual(["contact.nickname", "company.size"]);
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
      asha,
      meeting,
    );
    expect(result.body).toContain("Discovery call on");
    expect(result.body).toContain("45 minutes");
    expect(result.body).toContain("https://meet.google.com/abc-defg-hij");
    expect(result.unknownTokens).toEqual([]);
  });

  it.each(["meeting.date", "meeting.time", "meeting.title", "meeting.duration", "meeting.link"])("rejects %s without meeting context in either subject or body", (token) => {
    expect(() => renderTemplate({ subject: null, body: `{{${token}}}` }, asha)).toThrow("require a scheduled meeting");
    expect(() => renderTemplate({ subject: `{{ ${token} }}`, body: "Hello" }, asha)).toThrow("require a scheduled meeting");
  });

  it.each([
    ["2026-12-31T18:29:00Z", "31 Dec 2026", "1 Jan 2027", "11:59 pm"],
    ["2026-12-31T18:30:00Z", "1 Jan 2027", "2 Jan 2027", "12:00 am"],
    ["2028-02-28T08:00:00Z", "28 Feb 2028", "29 Feb 2028", "1:30 pm"],
  ])("uses IST and handles calendar rollover at %s", (instant, today, tomorrow, time) => {
    const text = "{{current.date}} / {{tomorrow.date}} / {{current.time}}";
    const result = renderTemplate({ subject: text, body: text }, asha, undefined, new Date(instant));
    expect(result.body).toBe(`${today} / ${tomorrow} / ${time}`);
    expect(result.subject).toBe(result.body);
    expect(result.unknownTokens).toEqual([]);
    expect(findUnknownTemplateTokens(text)).toEqual([]);
  });

  it("maps meeting date/time to the meeting instant independently of the send date", () => {
    const result = renderTemplate(
      { subject: "{{meeting.date}} at {{meeting.time}}", body: "Today {{current.date}}; meeting {{meeting.date}} at {{meeting.time}}" },
      asha,
      { ...meeting, at: "2030-01-03T19:00:00Z" },
      new Date("2026-09-08T08:00:00Z"),
    );
    expect(result.subject).toBe("4 Jan 2030 at 12:30 am");
    expect(result.body).toBe("Today 8 Sept 2026; meeting 4 Jan 2030 at 12:30 am");
  });

  it("escapes meeting fields in HTML bodies while retaining plain subject values", () => {
    const result = renderTemplate({ subject: "{{meeting.title}}", body: "{{meeting.title}}" }, asha, { ...meeting, title: "<Call> & chat" });
    expect(result.subject).toBe("<Call> & chat");
    expect(result.body).toBe("&lt;Call&gt; &amp; chat");
  });

  it("renders a null meeting link as empty string rather than throwing", () => {
    const result = renderTemplate({ subject: null, body: "{{meeting.link}}" }, asha, { ...meeting, link: null });
    expect(result.body).toBe("");
  });
});

describe("findUnknownTemplateTokens", () => {
  it("returns nothing for text using only known variables", () => {
    expect(findUnknownTemplateTokens("Hi {{contact.firstName}} at {{company.name}}, from {{deal.ownerName}}")).toEqual([]);
  });

  it("flags unrecognized and retired tokens without needing a contact to render against", () => {
    expect(findUnknownTemplateTokens("Hi {{contact.firstName}}, {{contact.birthday}} {{company.size}}")).toEqual(["contact.birthday", "company.size"]);
  });

  it("de-duplicates repeated unknown tokens", () => {
    expect(findUnknownTemplateTokens("{{contact.x}} and {{contact.x}} again")).toEqual(["contact.x"]);
  });
});

describe("previewTemplate", () => {
  const meeting: TemplateRenderMeeting = { title: "Intro", at: "2030-01-03T09:30:00.000Z", durationMin: 30, link: null };

  it("fills every known variable when it has a deal and a meeting", () => {
    const body = KNOWN_TEMPLATE_VARIABLES.map((t) => `{{${t}}}`).join(" ");
    const result = previewTemplate({ subject: null, body }, asha, meeting);
    expect(result.missing).toEqual([]);
    expect(result.body).not.toContain("{{");
  });

  it("keeps unfilled tokens visible and says why: unknown, needs a deal, needs a meeting", () => {
    const result = previewTemplate(
      { subject: "{{deal.stage}} for {{contact.firstName}}", body: "{{meeting.date}} {{contact.nickname}} {{deal.stage}} {{company.name}}" },
      { ...asha, deal: null },
      null,
    );
    expect(result.subject).toBe("{{deal.stage}} for Asha");
    expect(result.body).toBe("{{meeting.date}} {{contact.nickname}} {{deal.stage}} Rao Textiles");
    expect(result.missing).toEqual([
      { token: "deal.stage", reason: "needs_deal" },
      { token: "meeting.date", reason: "needs_meeting" },
      { token: "contact.nickname", reason: "unknown" },
    ]);
  });
});
