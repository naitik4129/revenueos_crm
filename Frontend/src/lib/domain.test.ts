import { describe, expect, it } from "vitest";
import { normalizeDomain } from "./domain";

describe("normalizeDomain", () => {
  it("strips scheme, www, path and case", () => {
    expect(normalizeDomain("https://www.Acme.com/about?x=1")).toBe("acme.com");
    expect(normalizeDomain("acme.co.in")).toBe("acme.co.in");
  });

  it("is null when there is no domain", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
  });
});
