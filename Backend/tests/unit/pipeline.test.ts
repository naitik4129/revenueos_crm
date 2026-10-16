import { describe, expect, it } from "vitest";
import {
  assertPipelineStageEditable,
  assertValidPipelineStage,
  canRunAutomation,
  isClosedOutcome,
  lifecycleIndex,
  pipelineStageIndex,
} from "../../src/domain/pipeline.js";
import { InvalidTransitionError } from "../../src/errors.js";

describe("isClosedOutcome", () => {
  it("treats won/lost/discarded as closed", () => {
    for (const o of ["won", "lost", "discarded"] as const) expect(isClosedOutcome(o)).toBe(true);
  });
  it("treats open/nurture as not closed", () => {
    expect(isClosedOutcome("open")).toBe(false);
    expect(isClosedOutcome("nurture")).toBe(false);
  });
});

describe("canRunAutomation", () => {
  it("allows open and nurture deals of an active contact", () => {
    expect(canRunAutomation("open", "active")).toBe(true);
    expect(canRunAutomation("nurture", "active")).toBe(true);
  });
  it("blocks closed deals and DNC/merged contacts", () => {
    expect(canRunAutomation("won", "active")).toBe(false);
    expect(canRunAutomation("open", "do_not_contact")).toBe(false);
    expect(canRunAutomation("nurture", "merged")).toBe(false);
  });
});

describe("assertValidPipelineStage", () => {
  it("accepts a known stage", () => {
    expect(() => assertValidPipelineStage("meeting_scheduling")).not.toThrow();
  });
  it("rejects an old/unknown stage value (e.g. legacy 'Won')", () => {
    expect(() => assertValidPipelineStage("Won")).toThrow(InvalidTransitionError);
  });
});

describe("assertPipelineStageEditable", () => {
  it("allows editing while open", () => {
    expect(() => assertPipelineStageEditable("open")).not.toThrow();
  });
  it("blocks editing once the deal has left open (frozen stage)", () => {
    expect(() => assertPipelineStageEditable("won")).toThrow(InvalidTransitionError);
    expect(() => assertPipelineStageEditable("nurture")).toThrow(InvalidTransitionError);
  });
});

describe("ordering", () => {
  it("pipeline stages reflect funnel order", () => {
    expect(pipelineStageIndex("new")).toBe(0);
    expect(pipelineStageIndex("meeting_scheduled")).toBeGreaterThan(pipelineStageIndex("meeting_scheduling"));
    expect(pipelineStageIndex("proposal_sent")).toBeGreaterThan(pipelineStageIndex("meeting_scheduled"));
  });
  it("lifecycle stages run prospect -> customer", () => {
    expect(lifecycleIndex("prospect")).toBe(0);
    expect(lifecycleIndex("engaged")).toBeGreaterThan(lifecycleIndex("contacted"));
    expect(lifecycleIndex("customer")).toBeGreaterThan(lifecycleIndex("qualified"));
  });
});
