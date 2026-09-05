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

  it("routes Interested - Later with a 30-day follow-up when no restart date is captured", () => {
    const r = routeConnectedOutcome("interested_later");
    expect(r.stage).toBe("interested_later");
    expect(r.workflowTrigger).toBe("call_outcome_interested_later");
    expect(r.task).toMatchObject({ dueInDays: 30 });
  });

  it("routes Interested - Later to reconnect 7 days before the captured restart date", () => {
    const restartAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const r = routeConnectedOutcome("interested_later", { restartAt });
    expect(r.task?.dueInDays).toBe(13);
  });

  it("routes Future Possibility to a low-intensity 90-day check", () => {
    const r = routeConnectedOutcome("future_possibility");
    expect(r.stage).toBe("future_possibility");
    expect(r.workflowTrigger).toBe("call_outcome_future_possibility");
    expect(r.task).toMatchObject({ dueInDays: 90 });
  });

  it("routes Send Information to Connected - Qualifying with an active nurture sequence", () => {
    const r = routeConnectedOutcome("information_requested");
    expect(r.stage).toBe("connected_qualifying");
    expect(r.automation).toBe("active");
    expect(r.workflowTrigger).toBe("call_outcome_information_requested");
  });

  it.each([
    ["commission_only", "objection_commission_only"],
    ["internal_hiring", "objection_internal_hiring"],
    ["existing_team", "objection_existing_team"],
    ["budget_price", "objection_budget_price"],
    ["internal_approval", "objection_internal_approval"],
  ] as const)("routes %s objection to Objection Nurture + matching trigger", (outcome, trigger) => {
    const r = routeConnectedOutcome(outcome);
    expect(r.stage).toBe("objection_nurture");
    expect(r.objectionType).toBe(outcome);
    expect(r.workflowTrigger).toBe(trigger);
  });

  it("routes Wrong Fit to a manual archive/reroute task without nurture enrollment", () => {
    const r = routeConnectedOutcome("wrong_fit");
    expect(r.stage).toBeUndefined();
    expect(r.automation).toBe("manual");
    expect(r.objectionType).toBe("wrong_fit");
    expect(r.workflowTrigger).toBeUndefined();
  });

  it("routes Callback Requested to Manual with a callback task and does NOT touch stage", () => {
    const r = routeConnectedOutcome("callback_requested");
    expect(r.stage).toBeUndefined();
    expect(r.automation).toBe("manual");
    expect(r.task?.type).toBe("call");
    expect(r.workflowTrigger).toBeUndefined();
  });

  it("routes wrong_person to Connected - Qualifying without changing automation (preserve interaction)", () => {
    const r = routeConnectedOutcome("wrong_person");
    expect(r.stage).toBe("connected_qualifying");
    expect(r.automation).toBeUndefined();
    expect(r.task?.type).toBe("general_task");
  });
});
