import { describe, expect, it } from "vitest";
import type { Deal } from "@/types";
import { stageHeaders, uniqueDeals } from "./board";

const deal = (id: string, stage: Deal["stage"], amount: number | null = null) =>
  ({ id, stage, amount }) as Deal;

describe("stageHeaders", () => {
  const summary = [
    { stage: "new" as const, count: 40, amount: 500_000 },
    { stage: "negotiation" as const, count: 2, amount: 0 },
  ];

  it("has every stage in pipeline order, from the server's counts (not the loaded cards)", () => {
    const headers = stageHeaders(summary, [], {});
    expect([...headers.keys()][0]).toBe("new");
    expect([...headers.keys()].at(-1)).toBe("negotiation");
    expect(headers.get("new")).toEqual({ count: 40, amount: 500_000 });
    expect(headers.get("proposal_sent")).toEqual({ count: 0, amount: 0 });
  });

  it("counts a move being saved in its new stage, amount included", () => {
    const headers = stageHeaders(summary, [deal("a", "new", 100_000), deal("b", "new")], {
      a: "negotiation",
      b: "proposal_sent",
    });
    expect(headers.get("new")).toEqual({ count: 38, amount: 400_000 });
    expect(headers.get("negotiation")).toEqual({ count: 3, amount: 100_000 });
    expect(headers.get("proposal_sent")).toEqual({ count: 1, amount: 0 });
  });

  it("ignores a deal already in the stage it is moving to", () => {
    expect(stageHeaders(summary, [deal("a", "new")], { a: "new" }).get("new")!.count).toBe(40);
  });
});

describe("uniqueDeals", () => {
  it("keeps each deal once, in first-seen order", () => {
    const out = uniqueDeals([deal("a", "new"), deal("b", "new"), deal("a", "negotiation")]);
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });
});
