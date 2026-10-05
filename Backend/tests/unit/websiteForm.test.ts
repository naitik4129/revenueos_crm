import { describe, expect, it } from "vitest";
import {
  COMPANY_PLACEHOLDER,
  UNKNOWN_FIRST_NAME,
  formatSubmissionDetail,
  normalizeWebsiteForm,
  parseMessage,
  splitName,
} from "../../src/domain/websiteForm.js";

describe("splitName", () => {
  it("splits on the first space", () => {
    expect(splitName("Test User")).toEqual({ firstName: "Test", lastName: "User" });
    expect(splitName("Anna Maria de Souza")).toEqual({ firstName: "Anna", lastName: "Maria de Souza" });
  });

  it("handles a single word", () => {
    expect(splitName("Naitik")).toEqual({ firstName: "Naitik", lastName: "" });
  });

  it("trims and collapses messy whitespace", () => {
    expect(splitName("   Rahul    Sharma  ")).toEqual({ firstName: "Rahul", lastName: "Sharma" });
  });

  it("fixes case only when the name is entirely lower or upper case", () => {
    expect(splitName("RAHUL SHARMA")).toEqual({ firstName: "Rahul", lastName: "Sharma" });
    expect(splitName("rahul sharma")).toEqual({ firstName: "Rahul", lastName: "Sharma" });
    expect(splitName("Ravi McDonald")).toEqual({ firstName: "Ravi", lastName: "McDonald" });
    expect(splitName("Mary-Jane O'NEILL")).toEqual({ firstName: "Mary-Jane", lastName: "O'NEILL" });
  });

  it("falls back when the name is blank", () => {
    expect(splitName("")).toEqual({ firstName: UNKNOWN_FIRST_NAME, lastName: "" });
    expect(splitName(undefined)).toEqual({ firstName: UNKNOWN_FIRST_NAME, lastName: "" });
    expect(splitName("  \n\t ")).toEqual({ firstName: UNKNOWN_FIRST_NAME, lastName: "" });
  });
});

describe("parseMessage", () => {
  it("extracts labelled lines and keeps the rest as the challenge", () => {
    const parsed = parseMessage("Testing the form\nIndustry: Industrial Automation\nRevenue range: Rs.10–50Cr");
    expect(parsed.industry).toBe("Industrial Automation");
    expect(parsed.revenueRange).toBe("Rs.10–50Cr");
    expect(parsed.diagnosisIssue).toBeNull();
    expect(parsed.challenge).toBe("Testing the form");
  });

  it("reads the diagnosis issue and works with no challenge text", () => {
    const parsed = parseMessage("Industry: Pharma\nDiagnosis issue: Low pipeline");
    expect(parsed.industry).toBe("Pharma");
    expect(parsed.diagnosisIssue).toBe("Low pipeline");
    expect(parsed.challenge).toBe("");
  });

  it("is case-insensitive, order-independent and tolerant of spacing", () => {
    const parsed = parseMessage("REVENUE RANGE :  Rs.1-5Cr\nindustry:Textiles\nhello");
    expect(parsed.revenueRange).toBe("Rs.1-5Cr");
    expect(parsed.industry).toBe("Textiles");
    expect(parsed.challenge).toBe("hello");
  });

  it("handles CRLF and keeps the first occurrence of a repeated label", () => {
    const parsed = parseMessage("Need leads\r\nIndustry: A\r\nIndustry: B");
    expect(parsed.industry).toBe("A");
    expect(parsed.challenge).toBe("Need leads");
  });

  it("treats an empty label value as absent", () => {
    expect(parseMessage("Industry:   ").industry).toBeNull();
  });

  it("never throws on empty or missing input", () => {
    expect(parseMessage("")).toMatchObject({ industry: null, challenge: "", message: "" });
    expect(parseMessage(undefined)).toMatchObject({ industry: null, challenge: "" });
    expect(parseMessage(null)).toMatchObject({ industry: null, challenge: "" });
  });

  it("caps very long messages", () => {
    expect(parseMessage("x".repeat(20000)).message).toHaveLength(5000);
  });
});

describe("normalizeWebsiteForm", () => {
  it("normalizes the documented example payload", () => {
    const form = normalizeWebsiteForm({
      name: "Test User",
      email: "test@example.com",
      phone: "9876543210",
      company: "Test Pvt Ltd",
      message: "Testing the form\nIndustry: Industrial Automation\nRevenue range: Rs.10–50Cr",
    });
    expect(form).toMatchObject({
      firstName: "Test",
      lastName: "User",
      company: "Test Pvt Ltd",
      email: "test@example.com",
      phone: "9876543210",
      phoneE164: "+919876543210",
      invalidPhone: null,
      industry: "Industrial Automation",
      revenueRange: "Rs.10–50Cr",
      challenge: "Testing the form",
    });
  });

  it("lowercases and trims email, and drops an invalid one", () => {
    expect(normalizeWebsiteForm({ email: "  Test@Example.COM " }).email).toBe("test@example.com");
    expect(normalizeWebsiteForm({ email: "a@b" }).email).toBeNull();
    expect(normalizeWebsiteForm({ email: "not an email" }).email).toBeNull();
    expect(normalizeWebsiteForm({ email: "" }).email).toBeNull();
  });

  it("normalizes common phone formats", () => {
    for (const phone of ["98765 43210", "98765-43210", "(98765) 43210", "+91 98765 43210", "919876543210", "0091 98765 43210"]) {
      expect(normalizeWebsiteForm({ phone }).phoneE164, phone).toBe("+919876543210");
    }
  });

  it("keeps an international number's own country code", () => {
    expect(normalizeWebsiteForm({ phone: "+1 415 555 2671" }).phoneE164).toBe("+14155552671");
  });

  it("keeps a junk phone out of the lead but preserves the text", () => {
    const form = normalizeWebsiteForm({ phone: "abc", email: "a@example.com" });
    expect(form.phone).toBeNull();
    expect(form.phoneE164).toBeNull();
    expect(form.invalidPhone).toBe("abc");
    expect(formatSubmissionDetail(form)).toContain("abc");
  });

  it("uses a placeholder for a blank company and keeps casing otherwise", () => {
    expect(normalizeWebsiteForm({ company: "" }).company).toBe(COMPANY_PLACEHOLDER);
    expect(normalizeWebsiteForm({ company: "   " }).company).toBe(COMPANY_PLACEHOLDER);
    expect(normalizeWebsiteForm({ company: "  iFlex   Pvt  Ltd " }).company).toBe("iFlex Pvt Ltd");
    expect(normalizeWebsiteForm({ company: "ABB" }).company).toBe("ABB");
  });

  it("strips control characters", () => {
    const form = normalizeWebsiteForm({ name: "\u0000Rahul\u0007 Sharma", message: "hi\u0000 there" });
    expect(form.firstName).toBe("Rahul");
    expect(form.lastName).toBe("Sharma");
    expect(form.message).toBe("hi there");
  });

  it("handles a fully empty submission without throwing", () => {
    expect(normalizeWebsiteForm({})).toMatchObject({
      firstName: UNKNOWN_FIRST_NAME,
      company: COMPANY_PLACEHOLDER,
      email: null,
      phoneE164: null,
      challenge: "",
    });
  });
});

describe("formatSubmissionDetail", () => {
  it("is deterministic and human readable", () => {
    const form = normalizeWebsiteForm({ message: "Need help\nIndustry: Steel\nRevenue range: Rs.50Cr+\nDiagnosis issue: Churn" });
    expect(formatSubmissionDetail(form)).toBe("Message: Need help\nIndustry: Steel\nRevenue range: Rs.50Cr+\nDiagnosis issue: Churn");
    expect(formatSubmissionDetail(form)).toBe(formatSubmissionDetail(normalizeWebsiteForm({ message: "Need help\nIndustry: Steel\nRevenue range: Rs.50Cr+\nDiagnosis issue: Churn" })));
  });

  it("says so when there is nothing to show", () => {
    expect(formatSubmissionDetail(normalizeWebsiteForm({}))).toBe("No message provided.");
  });
});
