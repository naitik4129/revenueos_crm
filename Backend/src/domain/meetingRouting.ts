import type { LifecycleState, MeetingOutcome, PipelineStage, TaskType } from "./enums.js";

export interface MeetingRoutingResult {
  stage?: PipelineStage;
  lifecycle?: LifecycleState;
  task?: { type: TaskType; title: string; dueInDays: number };
}

/**
 * Meeting outcome routing (product brief, "MEETINGS" outcome routing table).
 * `no_proposal_required` is in the schema's meeting_outcome enum but not
 * called out explicitly in the product brief — treated as a soft resolution
 * that needs a human look rather than an automatic pipeline/lifecycle
 * change, which is the safe default per the "don't invent aggressive
 * behavior" instruction.
 */
export function routeMeetingOutcome(outcome: MeetingOutcome): MeetingRoutingResult {
  switch (outcome) {
    case "won":
      // Lifecycle-level outcome, not a pipeline stage -- mirrors the
      // proposal-accepted -> lifecycle_state = 'won' path exactly (no stage
      // change, no follow-up task; markWon cancels open tasks itself).
      return { lifecycle: "won" };
    case "proposal_required":
      return {
        stage: "proposal_preparation",
        task: { type: "prepare_proposal", title: "Prepare and upload proposal", dueInDays: 2 },
      };
    case "follow_up_required":
      return {
        stage: "meeting_follow_up",
        task: { type: "follow_up", title: "Follow up after meeting", dueInDays: 3 },
      };
    case "second_meeting":
      return {
        stage: "meeting_scheduling",
        task: { type: "schedule_meeting", title: "Book the second meeting", dueInDays: 3 },
      };
    case "not_interested":
      // Lifecycle-level outcome, not a pipeline stage — long_term_nurture
      // lives on lead_lifecycle_state, independent of pipeline_stage.
      return {
        lifecycle: "long_term_nurture",
        task: { type: "re_engage", title: "Long-term re-engagement", dueInDays: 45 },
      };
    case "no_proposal_required":
      return {
        task: { type: "internal_review", title: "Review meeting outcome — no proposal required", dueInDays: 2 },
      };
  }
}
