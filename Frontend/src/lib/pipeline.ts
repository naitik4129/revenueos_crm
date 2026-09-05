import type { ObjectionType, PipelineStage, WorkflowTrigger } from "@/types";

/**
 * Which call-outcome workflow trigger corresponds to a nurture pipeline
 * stage — used to pre-filter the "choose a workflow" picker when a rep
 * enrolls a lead that's already sitting in nurture without an active run
 * (e.g. its previous workflow finished). Undefined for any non-nurture
 * stage, or a stage with no dedicated trigger.
 */
const NURTURE_TRIGGER: Partial<Record<PipelineStage, WorkflowTrigger>> = {
  not_connected_nurture: "call_not_connected",
  interested_later: "call_outcome_interested_later",
  future_possibility: "call_outcome_future_possibility",
};

/** objection_nurture has one trigger per objection sub-type, not a single stage-level trigger. */
const OBJECTION_TRIGGER: Record<ObjectionType, WorkflowTrigger | undefined> = {
  commission_only: "objection_commission_only",
  internal_hiring: "objection_internal_hiring",
  existing_team: "objection_existing_team",
  budget_price: "objection_budget_price",
  internal_approval: "objection_internal_approval",
  wrong_fit: undefined,
};

export function nurtureTriggerForStage(
  stage: PipelineStage,
  objectionType?: ObjectionType,
): WorkflowTrigger | undefined {
  if (stage === "objection_nurture")
    return objectionType ? OBJECTION_TRIGGER[objectionType] : undefined;
  return NURTURE_TRIGGER[stage];
}
