import { InvalidTransitionError } from "../errors.js";
import {
  LIFECYCLE_STAGES,
  PIPELINE_STAGES,
  type ContactStatus,
  type DealOutcome,
  type LifecycleStage,
  type PipelineStage,
} from "./enums.js";

/** won / lost / discarded: the journey is over (nurture is parked, not closed). */
export function isClosedOutcome(outcome: DealOutcome): boolean {
  return outcome === "won" || outcome === "lost" || outcome === "discarded";
}

/** Automation may run only on an open or nurture deal of an active contact (same rule as the 009 trigger). */
export function canRunAutomation(outcome: DealOutcome, contactStatus: ContactStatus): boolean {
  return (outcome === "open" || outcome === "nurture") && contactStatus === "active";
}

export function assertValidPipelineStage(value: string): asserts value is PipelineStage {
  if (!(PIPELINE_STAGES as readonly string[]).includes(value)) {
    throw new InvalidTransitionError(`"${value}" is not a valid pipeline stage.`, {
      allowed: PIPELINE_STAGES,
    });
  }
}

/** Funnel position of a pipeline stage — PIPELINE_STAGES is ordered, so index comparison tells us forward vs backward movement. */
export function pipelineStageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

/**
 * The stage is only meaningful while a deal is open; once it leaves open the stage is
 * frozen (it records where the deal was when it closed or was parked).
 */
export function assertPipelineStageEditable(outcome: DealOutcome) {
  if (outcome !== "open") {
    throw new InvalidTransitionError(
      `Pipeline stage cannot be changed while the deal is "${outcome}". Reopen the deal first if this is a deliberate re-engagement.`,
    );
  }
}

export function lifecycleIndex(stage: LifecycleStage): number {
  return LIFECYCLE_STAGES.indexOf(stage);
}
