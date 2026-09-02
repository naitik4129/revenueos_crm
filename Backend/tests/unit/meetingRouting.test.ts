import { describe, expect, it } from "vitest";
import { routeMeetingOutcome } from "../../src/domain/meetingRouting.js";

describe("routeMeetingOutcome", () => {
  it("Proposal Required -> Proposal Preparation + prepare task", () => {
    const r = routeMeetingOutcome("proposal_required");
    expect(r.stage).toBe("proposal_preparation");
    expect(r.task).toMatchObject({ type: "prepare_proposal", dueInDays: 2 });
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

  it("Not Interested -> lifecycle Long-Term Nurture, not a pipeline stage", () => {
    const r = routeMeetingOutcome("not_interested");
    expect(r.lifecycle).toBe("long_term_nurture");
    expect(r.stage).toBeUndefined();
    expect(r.task).toMatchObject({ dueInDays: 45 });
  });

  it("Won -> lifecycle Won, no stage change, no task", () => {
    const r = routeMeetingOutcome("won");
    expect(r.lifecycle).toBe("won");
    expect(r.stage).toBeUndefined();
    expect(r.task).toBeUndefined();
  });
});
