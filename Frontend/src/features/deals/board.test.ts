import { describe, expect, it } from "vitest";
import type { Deal } from "@/types";
import { groupDealsByStage } from "./board";

const deal = (id: string, stage: Deal["stage"]) => ({ id, stage }) as Deal;

describe("groupDealsByStage", () => {
  it("has every stage in pipeline order, even empty ones", () => {
    const columns = groupDealsByStage([deal("a", "negotiation")], {});
    expect([...columns.keys()][0]).toBe("new");
    expect([...columns.keys()].at(-1)).toBe("negotiation");
    expect(columns.get("new")).toEqual([]);
    expect(columns.get("negotiation")!.map((d) => d.id)).toEqual(["a"]);
  });

  it("shows a pending move in its new column", () => {
    const columns = groupDealsByStage([deal("a", "new"), deal("b", "new")], { a: "proposal_sent" });
    expect(columns.get("new")!.map((d) => d.id)).toEqual(["b"]);
    expect(columns.get("proposal_sent")!.map((d) => d.id)).toEqual(["a"]);
  });
});
