import { describe, expect, it } from "vitest";
import type { LogCallResult } from "@/types";
import { describeDealResult } from "./call-result";

const withDeal = (id: string | null) => ({ deal: id ? { id } : null }) as unknown as LogCallResult;

describe("describeDealResult", () => {
  it("tells an existing open deal, a reopened nurture deal and a new deal apart", () => {
    expect(describeDealResult(withDeal("d1"), ["d1"], "d1")).toBe("Routed to the open deal");
    expect(describeDealResult(withDeal("d1"), ["d1"], undefined)).toBe(
      "Reopened the parked (nurture) deal",
    );
    expect(describeDealResult(withDeal("d2"), ["d1"], undefined)).toBe("Opened a new deal");
  });

  it("is null for contact-level outcomes (no deal)", () => {
    expect(describeDealResult(withDeal(null), [], undefined)).toBeNull();
  });
});
