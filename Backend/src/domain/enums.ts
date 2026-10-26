/**
 * Mirrors the enum vocabularies defined in Supabase/migrations/001_initial_migration.sql
 * (SECTION 2). Kept as plain TS unions + const arrays (not generated) since the
 * migration is the single source of truth and these rarely change; if a value
 * is added there, add it here too.
 */

/**
 * `maybe_nurture` and `negative_nurture` are intentionally omitted here even
 * though the Postgres enum still contains them (Postgres can't cheaply drop
 * an enum value). They are retired in favor of the richer stages below
 * (`interested_later`, `future_possibility`) and must never be produced by
 * application code again — see Backend/src/domain/callRouting.ts.
 *
 * `negotiation` has no dedicated routing function: it is reachable only via
 * the generic manual "Stage override" path (a rep sets it once commercial
 * back-and-forth starts on a proposal) — this is intentional, not a gap.
 */
export const PIPELINE_STAGES = [
  "new",
  "ready_for_first_call",
  "contact_attempted",
  "not_connected_nurture",
  "connected_qualifying",
  "interested_later",
  "future_possibility",
  "objection_nurture",
  "meeting_scheduling",
  "meeting_scheduled",
  "meeting_follow_up",
  "proposal_preparation",
  "proposal_sent",
  "proposal_decision_pending",
  "negotiation",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const OBJECTION_TYPES = [
  "commission_only",
  "internal_hiring",
  "existing_team",
  "budget_price",
  "internal_approval",
  "wrong_fit",
] as const;
export type ObjectionType = (typeof OBJECTION_TYPES)[number];

export const LEAD_LOSS_REASONS = [
  "price_budget",
  "internal_hiring",
  "project_postponed",
  "competitor_selected",
  "management_rejected",
  "no_urgency",
  "no_response",
  "other",
] as const;
export type LeadLossReason = (typeof LEAD_LOSS_REASONS)[number];

/** Consent, on the contact. */
export const CONTACT_STATUSES = ["active", "do_not_contact", "merged"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** The sales journey's result, on the deal. `nurture` is parked, not open. */
export const DEAL_OUTCOMES = ["open", "won", "lost", "nurture", "discarded"] as const;
export type DealOutcome = (typeof DEAL_OUTCOMES)[number];

/** HubSpot-style contact lifecycle, in order (code only moves it forward; admins may move it back). */
export const LIFECYCLE_STAGES = ["prospect", "contacted", "engaged", "qualified", "customer"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const ACTOR_SOURCES = ["user", "system", "automation", "brain"] as const;
export type ActorSource = (typeof ACTOR_SOURCES)[number];

export const AUTOMATION_MODES = ["active", "paused", "manual", "stopped"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const RESPONSE_STATES = [
  "no_response",
  "responded",
  "conversation_active",
  "waiting_on_customer",
  "waiting_on_us",
] as const;
export type ResponseState = (typeof RESPONSE_STATES)[number];

export const CONTACT_CHANNELS = ["phone", "email", "whatsapp"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_CHANNEL_STATUS: Record<ContactChannel, readonly string[]> = {
  phone: ["valid", "reachable", "temporarily_unreachable", "invalid", "wrong_number", "do_not_contact"],
  email: ["valid", "delivered", "temporary_bounce", "permanent_bounce", "unsubscribed", "invalid"],
  whatsapp: ["valid", "reachable", "temporarily_unreachable", "invalid", "opted_in", "opted_out", "do_not_contact"],
};

export const LEAD_SOURCES = [
  "linkedin",
  "email",
  "cold_call",
  "referral",
  "event",
  "inbound_form",
  "other",
  "brain",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const CALL_NOT_CONNECTED_REASONS = [
  "no_answer",
  "busy",
  "call_rejected",
  "switched_off",
  "temporarily_unreachable",
  "voicemail",
  "network_failure",
  "invalid_number",
  "wrong_number",
  "other",
] as const;
export type CallNotConnectedReason = (typeof CALL_NOT_CONNECTED_REASONS)[number];

/**
 * `maybe` and `negative` are intentionally omitted (see PIPELINE_STAGES
 * comment above for why they stay in Postgres but not here). Replaced by
 * `interested_later` and `future_possibility` respectively, plus 6 new
 * named dispositions in the Human Call Classification list. `wrong_fit`
 * (irrelevant company) is kept distinct from `wrong_person` (right company,
 * wrong contact) — a deliberate refinement rather than collapsing both into
 * one row; the existing `wrong_person` "preserve history, find the right
 * contact" behavior is worth keeping separately.
 */
export const CALL_CONNECTED_OUTCOMES = [
  "positive",
  "meeting_agreed",
  "interested_later",
  "future_possibility",
  "callback_requested",
  "information_requested",
  "commission_only",
  "internal_hiring",
  "existing_team",
  "budget_price",
  "internal_approval",
  "wrong_fit",
  "wrong_person",
  "do_not_contact",
] as const;
export type CallConnectedOutcome = (typeof CALL_CONNECTED_OUTCOMES)[number];

export const TASK_TYPES = [
  "call",
  "follow_up",
  "send_information",
  "send_case_study",
  "send_email",
  "send_whatsapp",
  "schedule_meeting",
  "confirm_meeting",
  "reschedule",
  "prepare_proposal",
  "send_proposal",
  "proposal_follow_up",
  "nurture",
  "re_engage",
  "internal_review",
  "general_task",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["open", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_ORIGINS = ["manual", "automation"] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];

export const MEETING_STATUSES = [
  "tentative",
  "scheduled",
  "confirmed",
  "rescheduled",
  "completed",
  "cancelled",
  "no_show",
  "failed",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/**
 * `follow_up_required` represents "Not ready -> Timed nurture" (kept, not
 * renamed — same meaning, now wired to a workflowTrigger it didn't have
 * before). `not_interested` represents "Not fit," deliberately still routed
 * to lifecycle long_term_nurture rather than discarded — see
 * Backend/src/domain/meetingRouting.ts for the rationale.
 */
export const MEETING_OUTCOMES = [
  "proposal_required",
  "highly_interested",
  "needs_internal_discussion",
  "needs_more_information",
  "won",
  "follow_up_required",
  "second_meeting",
  "not_interested",
  "no_proposal_required",
] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];

export const PROPOSAL_STATUSES = [
  "draft",
  "uploaded",
  "ready_to_send",
  "sent",
  "revision_requested",
  "revised",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * `call_outcome_maybe`/`call_outcome_negative` are intentionally omitted
 * (see CALL_CONNECTED_OUTCOMES comment) — replaced by
 * `call_outcome_interested_later`/`call_outcome_future_possibility`.
 *
 * `meeting_highly_interested`/`meeting_proposal_requested`/`meeting_not_a_fit`
 * are the dedicated triggers for those three meeting outcomes (see
 * meetingRouting.ts). `needs_internal_discussion` deliberately has no
 * trigger of its own — it reuses `objection_internal_approval`.
 */
export const WORKFLOW_TRIGGERS = [
  "deal_created",
  "meeting_scheduled",
  "meeting_agreed",
  "call_not_connected",
  "call_outcome_interested_later",
  "call_outcome_future_possibility",
  "call_outcome_information_requested",
  "objection_commission_only",
  "objection_internal_hiring",
  "objection_existing_team",
  "objection_budget_price",
  "objection_internal_approval",
  "meeting_needs_more_information",
  "meeting_not_ready",
  "meeting_highly_interested",
  "meeting_proposal_requested",
  "meeting_not_a_fit",
  "proposal_pending",
  "manual_enrollment",
] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const WORKFLOW_STATUSES = ["active", "paused"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_VERSION_STATUSES = ["draft", "published", "previous"] as const;
export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];

export const WORKFLOW_STEP_ACTIONS = [
  "send_email",
  "send_whatsapp",
  "create_call_task",
  "create_follow_up_task",
  "change_lead_stage",
  "stop_workflow",
] as const;
export type WorkflowStepAction = (typeof WORKFLOW_STEP_ACTIONS)[number];

export const WORKFLOW_RUN_STATUSES = [
  "running",
  "waiting",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const SCHEDULED_ACTION_STATUSES = [
  "pending",
  "due",
  "executing",
  "completed",
  "failed",
  "cancelled",
  "paused",
  "skipped",
] as const;
export type ScheduledActionStatus = (typeof SCHEDULED_ACTION_STATUSES)[number];

export const TEMPLATE_CHANNELS = ["email", "whatsapp"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

export const PROPOSAL_EMAIL_SEND_STATUSES = ["not_applicable", "pending", "skipped", "sent", "failed"] as const;
export type EmailSendStatus = (typeof PROPOSAL_EMAIL_SEND_STATUSES)[number];

export const PROPOSAL_WHATSAPP_SEND_STATUSES = ["not_applicable", "skipped", "queued", "sending", "sent", "failed"] as const;
export type WhatsappSendStatus = (typeof PROPOSAL_WHATSAPP_SEND_STATUSES)[number];

export const NOTIFICATION_KINDS = ["info", "warning", "success", "danger"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Campaign email status (crm_email_status); declared order = precedence, later wins. */
export const EMAIL_STATUSES = ["sent", "delivered", "opened", "replied", "bounced", "unsubscribed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
