import type {
  AutomationMode,
  CallConnectedOutcome,
  CallNotConnectedReason,
  PipelineStage,
  TaskType,
  WorkflowTrigger,
} from "./enums.js";

export interface TaskSpec {
  type: TaskType;
  title: string;
  /** Either a fixed number of days from now, or an explicit ISO timestamp (callback). */
  dueInDays?: number;
}

export interface CallRoutingResult {
  /** New pipeline_stage, if the outcome moves the lead forward. Undefined = leave as-is. */
  stage?: PipelineStage;
  /** New automation_mode, if the outcome changes it. Undefined = leave as-is. */
  automation?: AutomationMode;
  /** Next-action task to create, if any. */
  task?: TaskSpec;
  /** Nurture workflow trigger to auto-enroll into, if any. */
  workflowTrigger?: WorkflowTrigger;
  /** True when the outcome should immediately prompt the rep to schedule a meeting (Positive only). */
  promptScheduleMeeting?: boolean;
  /** Phone contactability status to record, if the reason implies the number itself is bad. */
  phoneContactStatus?: "invalid" | "wrong_number";
}

/**
 * Call Not Connected -> Not Connected Nurture (product brief, "NOT CONNECTED FLOW").
 * A bad-number reason also updates phone contactability without touching
 * lifecycle — other channels may still be usable (edge case: "Wrong Number").
 */
export function routeNotConnected(reason: CallNotConnectedReason): CallRoutingResult {
  const result: CallRoutingResult = {
    stage: "not_connected_nurture",
    automation: "active",
    task: { type: "call", title: "Retry call after nurture touch", dueInDays: 2 },
    workflowTrigger: "call_not_connected",
  };
  if (reason === "invalid_number") return { ...result, phoneContactStatus: "invalid" };
  if (reason === "wrong_number") return { ...result, phoneContactStatus: "wrong_number" };
  return result;
}

/**
 * Call Connected outcome routing (product brief, "POSITIVE/MAYBE/NEGATIVE FLOW"
 * + CALLBACK REQUESTED + edge cases). `do_not_contact` is handled separately
 * by callsService (it goes through the shared DNC path, not this table) and
 * is intentionally absent here.
 */
export function routeConnectedOutcome(
  outcome: Exclude<CallConnectedOutcome, "do_not_contact">,
): CallRoutingResult {
  switch (outcome) {
    case "positive":
      // Positive leads move quickly toward a meeting rather than nurture,
      // and become manually handled (product brief, "POSITIVE FLOW").
      return {
        stage: "meeting_scheduling",
        automation: "manual",
        task: { type: "schedule_meeting", title: "Schedule discovery meeting", dueInDays: 1 },
        promptScheduleMeeting: true,
      };
    case "maybe":
      return {
        stage: "maybe_nurture",
        automation: "active",
        task: { type: "follow_up", title: "Follow up after nurture email", dueInDays: 7 },
        workflowTrigger: "call_outcome_maybe",
      };
    case "negative":
      // Negative nurture stays controlled/limited (product brief) — a single
      // long-horizon re-engagement check, not an aggressive sequence.
      return {
        stage: "negative_nurture",
        automation: "active",
        task: { type: "follow_up", title: "Long-term re-engagement check", dueInDays: 30 },
        workflowTrigger: "call_outcome_negative",
      };
    case "callback_requested":
      // Not Maybe, not Negative — a distinct outcome. Stage is left
      // unchanged; the caller supplies the requested callback time.
      return {
        automation: "manual",
        task: { type: "call", title: "Callback requested by lead" },
      };
    case "information_requested":
      // Manual handling: the lead asked a direct question, this isn't a
      // nurture-sequence situation.
      return {
        automation: "manual",
        task: { type: "send_information", title: "Send requested information", dueInDays: 1 },
      };
    case "wrong_person":
      // Edge case: "Preserve the interaction. Do not automatically discard
      // all lead history." No stage/automation change — just get to the
      // right contact.
      return {
        task: { type: "general_task", title: "Confirm correct contact person", dueInDays: 2 },
      };
  }
}
