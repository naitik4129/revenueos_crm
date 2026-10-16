import { describe, expect, it } from "vitest";
import { validateContact } from "./contact-validation";

describe("validateContact", () => {
  it("needs a first name and one way to reach the contact", () => {
    expect(validateContact({ firstName: " " })).toEqual({
      firstName: "First name is required.",
      email: "Provide at least an email, a phone number or a LinkedIn URL.",
    });
  });

  it("accepts a LinkedIn URL alone", () => {
    expect(
      validateContact({ firstName: "Ann", linkedinUrl: "https://linkedin.com/in/ann" }),
    ).toEqual({});
  });

  it("rejects a bad email or phone", () => {
    expect(validateContact({ firstName: "Ann", email: "nope", phone: "12" })).toMatchObject({
      email: "Enter a valid email address.",
      phone: expect.stringContaining("valid phone number"),
    });
  });
});
