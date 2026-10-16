import { describe, expect, it } from "vitest";
import { parseContactsCsv, previewRowError, rowWantsDeal } from "./csv-contact-import";

describe("parseContactsCsv", () => {
  it("maps columns by name in any order, including the deal columns", () => {
    const parsed = parseContactsCsv(
      "Email,FIRST_NAME,Create Deal,Deal Title,Company,Source,Notes\nada@x.com,Ada,yes,Lead gen,Acme,Cold Call,ignored\n,,,,,,\n",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.unmatchedHeaders).toEqual(["Notes"]);
    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        firstName: "Ada",
        email: "ada@x.com",
        createDeal: "yes",
        dealTitle: "Lead gen",
        company: "Acme",
        source: "cold_call",
      },
    ]);
  });

  it("needs First Name and a way to reach the contact", () => {
    expect(parseContactsCsv("Email\na@x.com").error).toMatch(/First Name/);
    expect(parseContactsCsv("First Name,Company\nAda,Acme").error).toMatch(
      /Email, Phone or LinkedIn/,
    );
    expect(
      parseContactsCsv("First Name,LinkedIn\nAda,https://linkedin.com/in/ada").error,
    ).toBeNull();
  });
});

describe("row checks", () => {
  it("flags rows the backend would reject", () => {
    expect(previewRowError({ rowNumber: 2, firstName: "Ada" })).toMatch(
      /email, a phone number or a LinkedIn/,
    );
    expect(
      previewRowError({ rowNumber: 2, firstName: "Ada", email: "a@x.com", source: "cold_call" }),
    ).toBeNull();
    expect(
      previewRowError({ rowNumber: 2, firstName: "Ada", email: "a@x.com", source: "fax" }),
    ).toMatch(/Unknown source/);
  });

  it("wants a deal for yes/true/1 or any deal title", () => {
    expect(rowWantsDeal({ rowNumber: 2, firstName: "A", createDeal: "YES" })).toBe(true);
    expect(rowWantsDeal({ rowNumber: 2, firstName: "A", dealTitle: "SEO" })).toBe(true);
    expect(rowWantsDeal({ rowNumber: 2, firstName: "A", createDeal: "no" })).toBe(false);
  });
});
