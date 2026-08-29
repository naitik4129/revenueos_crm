import type { PipelineStage, WorkflowTrigger } from "@/types";

/**
 * Which call-outcome workflow trigger corresponds to a nurture pipeline
 * stage — used to pre-filter the "choose a workflow" picker when a rep
 * enrolls a lead that's already sitting in nurture without an active run
 * (e.g. its previous workflow finished). Undefined for any non-nurture
 * stage, or a stage with no dedicated trigger.
 */
const NURTURE_TRIGGER: Partial<Record<PipelineStage, WorkflowTrigger>> = {
  not_connected_nurture: "call_not_connected",
  maybe_nurture: "call_outcome_maybe",
  negative_nurture: "call_outcome_negative",
};

export function nurtureTriggerForStage(stage: PipelineStage): WorkflowTrigger | undefined {
  return NURTURE_TRIGGER[stage];
}
