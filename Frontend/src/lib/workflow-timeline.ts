import type { Run, Workflow, WorkflowStep } from "@/types";

export interface StepWithDay {
  step: WorkflowStep;
  /** Cumulative days from enrollment this step lands on (sum of delayDays up to and including this step). */
  day: number;
}

/**
 * The single source of truth for "Day N" math, shared by the workflow
 * builder's day badges and the lead detail page's Scheduled Follow-up
 * timeline, so the two views can never disagree about when a step fires.
 * Steps are returned in order with delayDays summed cumulatively (each
 * step's delayDays is relative to the previous step, matching how
 * Backend/src/services/runs.service.ts schedules them).
 */
export function stepsWithCumulativeDay(steps: WorkflowStep[]): StepWithDay[] {
  const ordered = steps.slice().sort((a, b) => a.order - b.order);
  let day = 0;
  return ordered.map((step) => {
    day += step.delayDays;
    return { step, day };
  });
}

/**
 * The single source of truth for "which step is a run currently on" —
 * shared by the lead detail page's Workflow runs card, the Runs page, and
 * the Scheduled follow-up timeline, so a run with no enabled steps left
 * (currentStep null while still running/waiting) reads the same everywhere
 * instead of three slightly different ad-hoc lookups each falling back to
 * their own "—"/undefined.
 */
export function findCurrentStep(
  workflow: Workflow | undefined,
  run: Run,
): WorkflowStep | undefined {
  return workflow?.versions
    .find((version) => version.version === run.version)
    ?.steps.find((step) => step.id === run.currentStep);
}
