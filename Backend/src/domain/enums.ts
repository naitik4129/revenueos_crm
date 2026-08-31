/**
 * Mirrors the enum vocabularies defined in Supabase/migrations/001_initial_migration.sql
 * (SECTION 2). Kept as plain TS unions + const arrays (not generated) since the
 * migration is the single source of truth and these rarely change; if a value
 * is added there, add it here too.
 */

export const PIPELINE_STAGES = [
  "new",
  "ready_for_first_call",
  "contact_attempted",
  "not_connected_nurture",
  "maybe_nurture",
  "negative_nurture",
  "meeting_scheduling",
  "meeting_scheduled",
  "meeting_follow_up",
  "proposal_preparation",
  "proposal_sent",
  "proposal_decision_pending",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const LIFECYCLE_STATES = [
  "active",
  "long_term_nurture",
  "won",
  "lost",
  "discarded",
  "do_not_contact",
  "merged",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const TERMINAL_LIFECYCLE_STATES: LifecycleState[] = [
  "won",
  "lost",
  "discarded",
  "do_not_contact",
  "merged",
];

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
  whatsapp: ["valid", "reachable", "temporarily_unreachable", "invalid", "opted_out", "do_not_contact"],
};

export const LEAD_SOURCES = [
  "linkedin",
  "email",
  "website",
  "cold_call",
  "referral",
  "event",
  "inbound_form",
  "other",
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

export const CALL_CONNECTED_OUTCOMES = [
  "positive",
  "maybe",
  "negative",
  "callback_requested",
  "information_requested",
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

export const MEETING_OUTCOMES = [
  "proposal_required",
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

export const WORKFLOW_TRIGGERS = [
  "call_not_connected",
  "call_outcome_maybe",
  "call_outcome_negative",
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
