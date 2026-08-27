import type { LifecycleState, PipelineStage, ProposalStatus, TaskType } from "./enums.js";

export interface ProposalRoutingResult {
  stage?: PipelineStage;
  lifecycle?: LifecycleState;
  task?: { type: TaskType; title: string; dueInDays: number };
  /** Cancel this lead's other open proposal-follow-up tasks (decision made). */
  cancelOpenProposalFollowUps?: boolean;
  /** Cancel every open task for the lead (Won — no acquisition next-action needed). */
  cancelAllOpenTasks?: boolean;
  workflowTrigger?: "proposal_pending";
}

/**
 * Proposal status routing (product brief, "PROPOSALS" section).
 *
 * `rejected`/`expired` are documented as moving "toward Lost or Long-Term
 * Nurture" with the explicit instruction not to invent aggressive behavior
 * and to use a safe default — Long-Term Nurture (non-destructive, matches
 * the existing frontend mock's Rejected handling) is that default. A
 * salesperson who confirms the lead is truly dead can still mark it Lost
 * explicitly via the lead-level endpoint.
 *
 * `draft`/`uploaded`/`ready_to_send`/`revised`/`withdrawn` have no
 * automatic pipeline/lifecycle effect — nothing in the product brief
 * specifies one, so we only record the status change (see proposals
 * service) rather than guessing.
 */
export function routeProposalStatus(status: ProposalStatus): ProposalRoutingResult {
  switch (status) {
    case "sent":
      return {
        stage: "proposal_decision_pending",
        task: { type: "proposal_follow_up", title: "Follow up on proposal", dueInDays: 3 },
        workflowTrigger: "proposal_pending",
      };
    case "revision_requested":
      return {
        stage: "proposal_preparation",
        task: { type: "prepare_proposal", title: "Revise proposal per customer feedback", dueInDays: 2 },
        cancelOpenProposalFollowUps: true,
      };
    case "accepted":
      return {
        lifecycle: "won",
        cancelAllOpenTasks: true,
      };
    case "rejected":
      return {
        lifecycle: "long_term_nurture",
        task: { type: "re_engage", title: "Re-engage after rejection", dueInDays: 45 },
        cancelOpenProposalFollowUps: true,
      };
    case "expired":
      return {
        lifecycle: "long_term_nurture",
        task: { type: "re_engage", title: "Re-engage after proposal expired", dueInDays: 45 },
        cancelOpenProposalFollowUps: true,
      };
    case "draft":
    case "uploaded":
    case "ready_to_send":
    case "revised":
    case "withdrawn":
      return {};
  }
}
