import { describe, expect, it } from "vitest";
import {
  assertPipelineStageEditable,
  assertValidPipelineStage,
  isTerminalLifecycle,
  pipelineStageIndex,
} from "../../src/domain/pipeline.js";
import { InvalidTransitionError } from "../../src/errors.js";

describe("isTerminalLifecycle", () => {
  it("treats won/lost/discarded/do_not_contact/merged as terminal", () => {
    for (const s of ["won", "lost", "discarded", "do_not_contact", "merged"] as const) {
      expect(isTerminalLifecycle(s)).toBe(true);
    }
  });
  it("treats active/long_term_nurture as non-terminal", () => {
    expect(isTerminalLifecycle("active")).toBe(false);
    expect(isTerminalLifecycle("long_term_nurture")).toBe(false);
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
  it("allows editing while active", () => {
    expect(() => assertPipelineStageEditable("active")).not.toThrow();
  });
  it("blocks editing once a lead has left active (frozen stage)", () => {
    expect(() => assertPipelineStageEditable("won")).toThrow(InvalidTransitionError);
    expect(() => assertPipelineStageEditable("do_not_contact")).toThrow(InvalidTransitionError);
  });
});

describe("pipelineStageIndex", () => {
  it("reflects funnel order", () => {
    expect(pipelineStageIndex("new")).toBe(0);
    expect(pipelineStageIndex("meeting_scheduled")).toBeGreaterThan(pipelineStageIndex("meeting_scheduling"));
    expect(pipelineStageIndex("proposal_sent")).toBeGreaterThan(pipelineStageIndex("meeting_scheduled"));
  });
});
