import { describe, expect, it } from "vitest";
import {
  importInChunks,
  parseContactsCsv,
  previewRowError,
  rowWantsDeal,
} from "./csv-contact-import";

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

describe("importInChunks", () => {
  const rows = Array.from({ length: 1200 }, (_, i) => ({ rowNumber: i + 2, firstName: `P${i}` }));

  it("sends chunks of 500 in order and merges the results", async () => {
    const sizes: number[] = [];
    const progress: number[] = [];
    const result = await importInChunks(
      rows,
      async (chunk) => {
        sizes.push(chunk.length);
        return {
          created: chunk.slice(1).map((r) => `id-${r.rowNumber}`),
          duplicates: [{ rowNumber: chunk[0]!.rowNumber, reason: "dup" }],
          failed: [],
          totalRows: chunk.length,
        };
      },
      (done) => progress.push(done),
    );
    expect(sizes).toEqual([500, 500, 200]);
    expect(progress).toEqual([500, 1000, 1200]);
    expect(result.created).toHaveLength(1197);
    expect(result.duplicates.map((d) => d.rowNumber)).toEqual([2, 502, 1002]);
    expect(result).toMatchObject({ totalRows: 1200, error: null });
  });

  it("keeps earlier chunks and reports the failed chunk and the rest as not imported", async () => {
    let calls = 0;
    const result = await importInChunks(
      rows,
      async (chunk) => {
        if (++calls === 2) throw new Error("Server down");
        return {
          created: chunk.map((r) => `id-${r.rowNumber}`),
          duplicates: [],
          failed: [],
          totalRows: chunk.length,
        };
      },
      () => {},
    );
    expect(calls).toBe(2);
    expect(result.created).toHaveLength(500);
    expect(result.failed).toHaveLength(700);
    expect(result.failed[0]).toEqual({ rowNumber: 502, reason: "Not imported: Server down" });
    expect(result.error).toBe("Server down");
  });
});
