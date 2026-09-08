import type {
  AutomationMode,
  CallConnectedOutcome,
  CallNotConnectedReason,
  ObjectionType,
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

/** "Interested - Later" capture fields — free text/date, not a closed vocabulary. */
export interface InterestedLaterCapture {
  reason?: string;
  restartAt?: string;
  nextAction?: string;
  decisionOwner?: string;
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
  /** True when the outcome should immediately prompt the rep to schedule a meeting (Positive and Meeting Agreed). */
  promptScheduleMeeting?: boolean;
  /** Phone contactability status to record, if the reason implies the number itself is bad. */
  phoneContactStatus?: "invalid" | "wrong_number";
  /** Set alongside stage = 'objection_nurture' (or for wrong_fit, reporting-only). */
  objectionType?: ObjectionType;
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "Reconnect using the customer's own earlier timing" — reconnect shortly
 * BEFORE the date the customer indicated, not on/after it. Falls back to
 * the old 'maybe' outcome's 30-day default when no restart date was
 * captured (the field is optional — the exact month/date is captured where
 * possible, not required).
 */
function interestedLaterDueInDays(restartAt?: string): number {
  const fallback = 30;
  if (!restartAt) return fallback;
  const restart = Date.parse(restartAt);
  if (Number.isNaN(restart)) return fallback;
  const days = Math.round((restart - Date.now()) / MS_PER_DAY) - 7;
  return Math.max(days, 1);
}

/**
 * Call Connected outcome routing — the Human Call Classification disposition
 * table. `do_not_contact` is handled separately by callsService (it goes
 * through the shared DNC path, not this table) and is intentionally absent
 * here.
 */
export function routeConnectedOutcome(
  outcome: Exclude<CallConnectedOutcome, "do_not_contact">,
  capture?: InterestedLaterCapture,
): CallRoutingResult {
  switch (outcome) {
    case "positive":
      // Positive leads move quickly toward a meeting rather than nurture,
      // and become manually handled (Meeting Agreed sequence).
      return {
        stage: "meeting_scheduling",
        automation: "manual",
        task: { type: "schedule_meeting", title: "Schedule discovery meeting", dueInDays: 1 },
        promptScheduleMeeting: true,
      };
    case "meeting_agreed":
      // Schedule-first, enroll-after: promptScheduleMeeting opens the
      // scheduling dialog immediately, and the workflowTrigger is only acted
      // on once that meeting is actually booked (frontend chains it) —
      // scheduleMeeting() cancels every active workflow run for the lead, so
      // enrolling before the meeting exists would get silently undone.
      return {
        stage: "meeting_scheduling",
        automation: "active",
        task: { type: "schedule_meeting", title: "Schedule agreed meeting", dueInDays: 1 },
        workflowTrigger: "meeting_agreed",
        promptScheduleMeeting: true,
      };
    case "interested_later":
      // The capture (reason/restart date/next action/decision owner) is
      // written onto the lead by the caller (calls.service.ts); routing here
      // only decides the reconnect timing and nurture enrollment.
      return {
        stage: "interested_later",
        automation: "active",
        task: {
          type: "follow_up",
          title: "Reconnect per stated timing",
          dueInDays: interestedLaterDueInDays(capture?.restartAt),
        },
        workflowTrigger: "call_outcome_interested_later",
      };
    case "future_possibility":
      // Low-intensity, long-horizon nurture. Not permanently closed, so
      // lifecycle stays active (unlike long_term_nurture, which is a
      // lifecycle-level bucket reached from other paths).
      return {
        stage: "future_possibility",
        automation: "active",
        task: { type: "follow_up", title: "Long-term low-intensity check-in", dueInDays: 90 },
        workflowTrigger: "call_outcome_future_possibility",
      };
    case "callback_requested":
      // A distinct outcome — stage is left unchanged; the caller supplies
      // the requested callback time.
      return {
        automation: "manual",
        task: { type: "call", title: "Callback requested by lead" },
      };
    case "information_requested":
      // "Send Me Details First": progressive email sequence, then a human
      // call to gauge relevance before a meeting CTA — an active nurture
      // sequence, not a one-off manual task.
      return {
        stage: "connected_qualifying",
        automation: "active",
        task: { type: "follow_up", title: "Call after info sequence - gauge relevance", dueInDays: 10 },
        workflowTrigger: "call_outcome_information_requested",
      };
    case "commission_only":
      return objectionRouting("commission_only", "objection_commission_only", "Follow up: Commission-only objection", 5);
    case "internal_hiring":
      return objectionRouting("internal_hiring", "objection_internal_hiring", "Follow up: Internal hiring objection", 5);
    case "existing_team":
      return objectionRouting("existing_team", "objection_existing_team", "Follow up: Existing team objection", 5);
    case "budget_price":
      return objectionRouting("budget_price", "objection_budget_price", "Follow up: Budget/price objection", 5);
    case "internal_approval":
      // A decision-maker-ready one-pager, not a generic follow-up email, is
      // the concrete next action.
      return {
        stage: "objection_nurture",
        automation: "active",
        task: { type: "general_task", title: "Prepare decision-maker one-pager", dueInDays: 2 },
        workflowTrigger: "objection_internal_approval",
        objectionType: "internal_approval",
      };
    case "wrong_fit":
      // "Wrong Fit -> Archive, reroute or find correct contact" — a human
      // decision, not an automatic nurture enrollment. Recorded for
      // reporting (objectionType) without moving the lead into
      // objection_nurture, since this isn't a sequence to be nurtured
      // through — matches the existing "don't invent aggressive/automatic
      // behavior" philosophy already used for wrong_person/no_proposal_required.
      return {
        automation: "manual",
        task: { type: "general_task", title: "Confirm fit - archive or reroute", dueInDays: 2 },
        objectionType: "wrong_fit",
      };
    case "wrong_person":
      // Edge case: "Preserve the interaction. Do not automatically discard
      // all lead history." No stage/automation change — just get to the
      // right contact. Kept distinct from wrong_fit (see enums.ts comment).
      return {
        stage: "connected_qualifying",
        task: { type: "general_task", title: "Confirm correct contact person", dueInDays: 2 },
      };
  }
}

function objectionRouting(
  objectionType: NonNullable<CallRoutingResult["objectionType"]>,
  workflowTrigger: Extract<
    WorkflowTrigger,
    | "objection_commission_only"
    | "objection_internal_hiring"
    | "objection_existing_team"
    | "objection_budget_price"
  >,
  taskTitle: string,
  dueInDays: number,
): CallRoutingResult {
  return {
    stage: "objection_nurture",
    automation: "active",
    task: { type: "follow_up", title: taskTitle, dueInDays },
    workflowTrigger,
    objectionType,
  };
}
