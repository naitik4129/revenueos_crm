import type { TaskType } from "./task";

/**
 * `maybe_nurture`/`negative_nurture` are intentionally omitted — retired in
 * favor of `interested_later`/`future_possibility` (mirrors
 * Backend/src/domain/enums.ts exactly; keep both files in sync).
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
export const CONTACT_CHANNELS = ["phone", "email", "whatsapp"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export type PhoneContactabilityStatus =
  "valid" | "reachable" | "temporarily_unreachable" | "invalid" | "wrong_number" | "do_not_contact";
export type EmailContactabilityStatus =
  "valid" | "delivered" | "temporary_bounce" | "permanent_bounce" | "unsubscribed" | "invalid";
export type WhatsAppContactabilityStatus =
  "valid" | "reachable" | "temporarily_unreachable" | "invalid" | "opted_out" | "do_not_contact";
type ContactabilityBase = { reason?: string; updatedAt: string };
export type Contactability =
  | (ContactabilityBase & { channel: "phone"; status: PhoneContactabilityStatus })
  | (ContactabilityBase & { channel: "email"; status: EmailContactabilityStatus })
  | (ContactabilityBase & { channel: "whatsapp"; status: WhatsAppContactabilityStatus });
export interface NextAction {
  taskId: string;
  type: TaskType;
  title: string;
  dueAt: string;
  ownerId?: string;
  ownerName?: string;
  origin: "manual" | "automation";
}
export interface LeadNote {
  id: string;
  author: string;
  at: string;
  body: string;
}
export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  industry: string;
  phone: string;
  email: string;
  source: LeadSource;
  serviceInterest: string;
  ownerId?: string;
  ownerName?: string;
  pipelineStage: PipelineStage;
  lifecycleState: LifecycleState;
  automationMode: AutomationMode;
  responseState: ResponseState;
  doNotContact: boolean;
  dncReason?: string;
  dncBy?: string;
  dncAt?: string;
  objectionType?: ObjectionType;
  interestedLaterReason?: string;
  interestedLaterRestartAt?: string;
  interestedLaterNextAction?: string;
  interestedLaterDecisionOwner?: string;
  lossReason?: LeadLossReason;
  lossNotes?: string;
  mergedIntoLeadId?: string;
  lastActivityAt: string;
  nextAction: NextAction | null;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

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
/** `maybe`/`negative` intentionally omitted — see PIPELINE_STAGES comment above. */
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
export interface Call {
  id: string;
  leadId: string;
  salespersonId?: string;
  salespersonName: string;
  connected: boolean;
  notConnectedReason?: CallNotConnectedReason;
  connectedOutcome?: CallConnectedOutcome;
  notes?: string;
  callbackDueAt?: string;
  createdAt: string;
}
