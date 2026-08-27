import { describe, expect, it } from "vitest";
import { routeConnectedOutcome, routeNotConnected } from "../../src/domain/callRouting.js";

describe("routeNotConnected", () => {
  it("enrolls in Not Connected Nurture with a retry task", () => {
    const r = routeNotConnected("no_answer");
    expect(r.stage).toBe("not_connected_nurture");
    expect(r.automation).toBe("active");
    expect(r.workflowTrigger).toBe("call_not_connected");
    expect(r.task).toMatchObject({ type: "call", dueInDays: 2 });
    expect(r.phoneContactStatus).toBeUndefined();
  });

  it("flags phone contactability on invalid_number without touching lifecycle", () => {
    const r = routeNotConnected("invalid_number");
    expect(r.phoneContactStatus).toBe("invalid");
    expect(r.stage).toBe("not_connected_nurture");
  });

  it("flags phone contactability on wrong_number (edge case: preserve other channels)", () => {
    const r = routeNotConnected("wrong_number");
    expect(r.phoneContactStatus).toBe("wrong_number");
  });
});

describe("routeConnectedOutcome", () => {
  it("routes Positive to Meeting Scheduling + Manual + schedule task, no nurture", () => {
    const r = routeConnectedOutcome("positive");
    expect(r.stage).toBe("meeting_scheduling");
    expect(r.automation).toBe("manual");
    expect(r.workflowTrigger).toBeUndefined();
    expect(r.task?.type).toBe("schedule_meeting");
  });

  it("routes Maybe to Maybe Nurture with a 7-day follow-up", () => {
    const r = routeConnectedOutcome("maybe");
    expect(r.stage).toBe("maybe_nurture");
    expect(r.workflowTrigger).toBe("call_outcome_maybe");
    expect(r.task).toMatchObject({ dueInDays: 7 });
  });

  it("routes Negative to Negative Nurture with a 30-day check", () => {
    const r = routeConnectedOutcome("negative");
    expect(r.stage).toBe("negative_nurture");
    expect(r.workflowTrigger).toBe("call_outcome_negative");
    expect(r.task).toMatchObject({ dueInDays: 30 });
  });

  it("routes Callback Requested to Manual with a callback task and does NOT touch stage", () => {
    const r = routeConnectedOutcome("callback_requested");
    expect(r.stage).toBeUndefined();
    expect(r.automation).toBe("manual");
    expect(r.task?.type).toBe("call");
    // must not be classified as Maybe/Negative nurture (product brief rule)
    expect(r.workflowTrigger).toBeUndefined();
  });

  it("routes wrong_person without changing stage/automation (preserve interaction)", () => {
    const r = routeConnectedOutcome("wrong_person");
    expect(r.stage).toBeUndefined();
    expect(r.automation).toBeUndefined();
    expect(r.task?.type).toBe("general_task");
  });
});
