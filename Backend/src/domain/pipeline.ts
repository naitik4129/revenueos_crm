import { InvalidTransitionError } from "../errors.js";
import { LIFECYCLE_STATES, PIPELINE_STAGES, TERMINAL_LIFECYCLE_STATES, type LifecycleState, type PipelineStage } from "./enums.js";

export function isTerminalLifecycle(state: LifecycleState): boolean {
  return TERMINAL_LIFECYCLE_STATES.includes(state);
}

export function assertValidPipelineStage(value: string): asserts value is PipelineStage {
  if (!(PIPELINE_STAGES as readonly string[]).includes(value)) {
    throw new InvalidTransitionError(`"${value}" is not a valid pipeline stage.`, {
      allowed: PIPELINE_STAGES,
    });
  }
}

export function assertValidLifecycleState(value: string): asserts value is LifecycleState {
  if (!(LIFECYCLE_STATES as readonly string[]).includes(value)) {
    throw new InvalidTransitionError(`"${value}" is not a valid lifecycle state.`, {
      allowed: LIFECYCLE_STATES,
    });
  }
}

/**
 * pipeline_stage is only meaningful while a lead is lifecycle_state = active
 * (see leads.pipeline_stage column comment in the migration: it is frozen,
 * not reset, once a lead leaves active). Editing it on a non-active lead
 * would silently rewrite "what stage was this lead at when it closed" —
 * exactly what the schema is designed to prevent.
 */
export function assertPipelineStageEditable(lifecycle: LifecycleState) {
  if (lifecycle !== "active") {
    throw new InvalidTransitionError(
      `Pipeline stage cannot be changed while the lead's lifecycle is "${lifecycle}". ` +
        `Reactivate the lead first if this is a deliberate re-engagement.`,
    );
  }
}
