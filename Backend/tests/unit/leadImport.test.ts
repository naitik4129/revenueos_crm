import { describe, expect, it } from "vitest";
import { validateLeadFields } from "../../src/services/leads.service.js";
import { ValidationError } from "../../src/errors.js";

const base = {
  firstName: "Grace",
  company: "Compiler Co",
  email: "grace@example.com",
  source: "website",
};

describe("validateLeadFields", () => {
  it("requires a first name", () => {
    expect(() => validateLeadFields({ ...base, firstName: "  " })).toThrow(
      "First name is required.",
    );
  });

  it("requires a company", () => {
    expect(() => validateLeadFields({ ...base, company: "" })).toThrow("Company is required.");
  });

  it("requires an email or a phone", () => {
    expect(() => validateLeadFields({ ...base, email: "" })).toThrow(
      "Provide at least an email or a phone number.",
    );
  });

  it("rejects an invalid phone number", () => {
    expect(() => validateLeadFields({ ...base, email: "", phone: "not-a-phone" })).toThrow(
      /Enter a valid phone number/,
    );
  });

  it("normalizes a bare Indian number to +91 E.164", () => {
    const fields = validateLeadFields({ ...base, email: "", phone: "9876543210" });
    expect(fields.phoneE164).toBe("+919876543210");
  });

  it("rejects an unrecognized source with a friendly message", () => {
    expect(() => validateLeadFields({ ...base, source: "made_up_source" })).toThrow(
      /Unknown source "made_up_source" — must be one of:/,
    );
  });

  it("accepts a known source and returns trimmed/normalized fields", () => {
    const fields = validateLeadFields({
      firstName: "  Grace  ",
      lastName: "  Hopper  ",
      company: "  Compiler Co  ",
      email: "  grace@example.com  ",
      source: "linkedin",
    });
    expect(fields).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
      company: "Compiler Co",
      email: "grace@example.com",
      source: "linkedin",
      phone: null,
      phoneE164: null,
    });
  });

  it("throws ValidationError instances, not generic errors", () => {
    try {
      validateLeadFields({ ...base, firstName: "" });
      throw new Error("expected validateLeadFields to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
    }
  });

  it("rejects an invalid email format", () => {
    expect(() => validateLeadFields({ ...base, email: "not-an-email" })).toThrow(
      "Enter a valid email address.",
    );
  });

  it("normalizes email to lowercase", () => {
    const fields = validateLeadFields({ ...base, email: "Grace@Example.COM" });
    expect(fields.email).toBe("grace@example.com");
  });

  it("attaches the offending field name to each ValidationError", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, firstName: "" }, "firstName"],
      [{ ...base, company: "" }, "company"],
      [{ ...base, email: "" }, "email"],
      [{ ...base, email: "not-an-email" }, "email"],
      [{ ...base, email: "", phone: "not-a-phone" }, "phone"],
      [{ ...base, source: "made_up_source" }, "source"],
    ];
    for (const [input, field] of cases) {
      try {
        validateLeadFields(input as Parameters<typeof validateLeadFields>[0]);
        throw new Error(`expected validateLeadFields to throw for field ${field}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).details).toMatchObject({ field });
      }
    }
  });
});
