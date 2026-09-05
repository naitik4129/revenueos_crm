import type { LifecycleState, MeetingOutcome, ObjectionType, PipelineStage, TaskType, WorkflowTrigger } from "./enums.js";

export interface MeetingRoutingResult {
  stage?: PipelineStage;
  lifecycle?: LifecycleState;
  task?: { type: TaskType; title: string; dueInDays: number };
  workflowTrigger?: WorkflowTrigger;
  objectionType?: ObjectionType;
}

/**
 * Meeting outcome routing — the Post-Meeting / Demo Nurture outcome table.
 * `no_proposal_required` is in the schema's meeting_outcome enum but not
 * called out as a distinct row elsewhere — treated as a soft resolution
 * that needs a human look rather than an automatic pipeline/lifecycle
 * change, the safe default per the "don't invent aggressive behavior"
 * philosophy already established in this file.
 */
export function routeMeetingOutcome(outcome: MeetingOutcome): MeetingRoutingResult {
  switch (outcome) {
    case "won":
      // Lifecycle-level outcome, not a pipeline stage -- mirrors the
      // proposal-accepted -> lifecycle_state = 'won' path exactly (no stage
      // change, no follow-up task; markWon cancels open tasks itself).
      return { lifecycle: "won" };
    case "highly_interested":
      // "Highly interested -> Proposal / solution discussion" — moves
      // toward a proposal like proposal_required, but the immediate next
      // action is a discussion, not preparing a document yet.
      return {
        stage: "proposal_preparation",
        task: { type: "general_task", title: "Schedule proposal/solution discussion", dueInDays: 2 },
      };
    case "proposal_required":
      // "Proposal requested -> Proposal stage nurture".
      return {
        stage: "proposal_preparation",
        task: { type: "prepare_proposal", title: "Prepare and upload proposal", dueInDays: 2 },
      };
    case "needs_internal_discussion":
      // "Needs internal discussion -> Decision-maker support" — the same
      // situation as the call-stage "Internal Approval" objection (its
      // one-pager), so it reuses that exact nurture track rather than
      // inventing a parallel one.
      return {
        stage: "objection_nurture",
        objectionType: "internal_approval",
        task: { type: "general_task", title: "Prepare decision-maker one-pager", dueInDays: 2 },
        workflowTrigger: "objection_internal_approval",
      };
    case "needs_more_information":
      // "Needs more information -> Evidence / case-study sequence".
      return {
        stage: "meeting_follow_up",
        task: { type: "send_case_study", title: "Send evidence / case studies", dueInDays: 2 },
        workflowTrigger: "meeting_needs_more_information",
      };
    case "follow_up_required":
      // "Not ready -> Timed nurture".
      return {
        stage: "meeting_follow_up",
        task: { type: "follow_up", title: "Follow up after meeting", dueInDays: 3 },
        workflowTrigger: "meeting_not_ready",
      };
    case "second_meeting":
      return {
        stage: "meeting_scheduling",
        task: { type: "schedule_meeting", title: "Book the second meeting", dueInDays: 3 },
      };
    case "not_interested":
      // "Not fit -> Archive / alternate service if relevant". Kept routed
      // to long_term_nurture rather than discarded — a deliberate deviation
      // from the literal "Archive" wording: this file's own existing
      // philosophy (see module doc-comment) is not to invent
      // destructive/aggressive automatic behavior. A rep who judges the
      // lead truly dead can still Discard it explicitly from the lead
      // detail page.
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
