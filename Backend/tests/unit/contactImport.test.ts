import { describe, expect, it } from "vitest";
import { validateContactFields } from "../../src/services/contacts.service.js";
import { ValidationError } from "../../src/errors.js";

const base = { firstName: "Grace", email: "grace@example.com", source: "linkedin" };

describe("validateContactFields", () => {
  it("requires a first name", () => {
    expect(() => validateContactFields({ ...base, firstName: "  " })).toThrow("First name is required.");
  });

  it("requires an email, a phone or a LinkedIn URL", () => {
    expect(() => validateContactFields({ ...base, email: "" })).toThrow("Provide at least an email, a phone number or a LinkedIn URL.");
    expect(validateContactFields({ ...base, email: "", linkedinUrl: "https://linkedin.com/in/grace" }).linkedinUrl).toBe(
      "https://linkedin.com/in/grace",
    );
  });

  it("rejects an invalid phone number or email", () => {
    expect(() => validateContactFields({ ...base, email: "", phone: "not-a-phone" })).toThrow(/Enter a valid phone number/);
    expect(() => validateContactFields({ ...base, email: "not-an-email" })).toThrow("Enter a valid email address.");
  });

  it("normalizes a bare Indian number to +91 E.164 and email to lowercase", () => {
    const fields = validateContactFields({ ...base, email: "Grace@Example.COM", phone: "9876543210" });
    expect(fields).toMatchObject({ email: "grace@example.com", phoneE164: "+919876543210" });
  });

  it("defaults the source to other and rejects unknown or retired sources", () => {
    expect(validateContactFields({ firstName: "A", email: "a@x.com" }).source).toBe("other");
    expect(() => validateContactFields({ ...base, source: "website" })).toThrow(/Unknown source "website"/);
  });

  it("returns trimmed fields", () => {
    expect(validateContactFields({ firstName: "  Grace ", lastName: " Hopper ", email: " grace@example.com ", source: "referral" })).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@example.com",
      source: "referral",
      phone: null,
      phoneE164: null,
    });
  });

  it("tags each ValidationError with the offending field", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, firstName: "" }, "firstName"],
      [{ ...base, email: "" }, "email"],
      [{ ...base, email: "not-an-email" }, "email"],
      [{ ...base, email: "", phone: "not-a-phone" }, "phone"],
      [{ ...base, source: "made_up" }, "source"],
    ];
    for (const [input, field] of cases) {
      try {
        validateContactFields(input as unknown as Parameters<typeof validateContactFields>[0]);
        throw new Error(`expected a ValidationError for ${field}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).details).toMatchObject({ field });
      }
    }
  });
});
