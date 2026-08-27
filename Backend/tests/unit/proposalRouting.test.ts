import { describe, expect, it } from "vitest";
import { routeProposalStatus } from "../../src/domain/proposalRouting.js";

describe("routeProposalStatus", () => {
  it("Sent -> Proposal Decision Pending + follow-up task + proposal_pending trigger", () => {
    const r = routeProposalStatus("sent");
    expect(r.stage).toBe("proposal_decision_pending");
    expect(r.task).toMatchObject({ type: "proposal_follow_up", dueInDays: 3 });
    expect(r.workflowTrigger).toBe("proposal_pending");
  });

  it("Accepted -> Won + cancel all open tasks, no stage change (lifecycle overrides stage)", () => {
    const r = routeProposalStatus("accepted");
    expect(r.lifecycle).toBe("won");
    expect(r.cancelAllOpenTasks).toBe(true);
    expect(r.stage).toBeUndefined();
  });

  it("Rejected -> safe default of Long-Term Nurture, not Lost", () => {
    const r = routeProposalStatus("rejected");
    expect(r.lifecycle).toBe("long_term_nurture");
    expect(r.task).toMatchObject({ dueInDays: 45 });
    expect(r.cancelOpenProposalFollowUps).toBe(true);
  });

  it("Draft/Uploaded/etc. have no automatic pipeline/lifecycle effect", () => {
    expect(routeProposalStatus("draft")).toEqual({});
    expect(routeProposalStatus("uploaded")).toEqual({});
    expect(routeProposalStatus("ready_to_send")).toEqual({});
  });
});
