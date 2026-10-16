import { describe, expect, it } from "vitest";
import { routeMeetingOutcome } from "../../src/domain/meetingRouting.js";

describe("routeMeetingOutcome", () => {
  it("Proposal Required -> Proposal Preparation + prepare task + Proposal Requested workflow", () => {
    const r = routeMeetingOutcome("proposal_required");
    expect(r.stage).toBe("proposal_preparation");
    expect(r.task).toMatchObject({ type: "prepare_proposal", dueInDays: 2 });
    expect(r.workflowTrigger).toBe("meeting_proposal_requested");
  });

  it("Follow-up Required -> Meeting Follow-up stage", () => {
    const r = routeMeetingOutcome("follow_up_required");
    expect(r.stage).toBe("meeting_follow_up");
  });

  it("Second Meeting -> Meeting Scheduling + schedule task", () => {
    const r = routeMeetingOutcome("second_meeting");
    expect(r.stage).toBe("meeting_scheduling");
    expect(r.task?.type).toBe("schedule_meeting");
  });

  it("Not Interested -> deal outcome Nurture, not a pipeline stage, enrolls Not a Fit workflow", () => {
    const r = routeMeetingOutcome("not_interested");
    expect(r.outcome).toBe("nurture");
    expect(r.stage).toBeUndefined();
    expect(r.task).toMatchObject({ dueInDays: 45 });
    expect(r.workflowTrigger).toBe("meeting_not_a_fit");
  });

  it("Won -> deal outcome Won, no stage change, no task", () => {
    const r = routeMeetingOutcome("won");
    expect(r.outcome).toBe("won");
    expect(r.stage).toBeUndefined();
    expect(r.task).toBeUndefined();
  });

  it("Highly Interested -> Proposal Preparation + discussion task + Highly Interested workflow", () => {
    const r = routeMeetingOutcome("highly_interested");
    expect(r.stage).toBe("proposal_preparation");
    expect(r.task?.type).toBe("general_task");
    expect(r.workflowTrigger).toBe("meeting_highly_interested");
  });

  it("Needs Internal Discussion -> Objection Nurture / internal_approval, reusing the call-stage track", () => {
    const r = routeMeetingOutcome("needs_internal_discussion");
    expect(r.stage).toBe("objection_nurture");
    expect(r.objectionType).toBe("internal_approval");
    expect(r.workflowTrigger).toBe("objection_internal_approval");
  });

  it("Needs More Information -> Meeting Follow-up + evidence sequence", () => {
    const r = routeMeetingOutcome("needs_more_information");
    expect(r.stage).toBe("meeting_follow_up");
    expect(r.task?.type).toBe("send_case_study");
    expect(r.workflowTrigger).toBe("meeting_needs_more_information");
  });

  it("Follow-up Required (Not Ready) now also enrolls a Timed Nurture sequence", () => {
    const r = routeMeetingOutcome("follow_up_required");
    expect(r.workflowTrigger).toBe("meeting_not_ready");
  });
});
