// The crm-schema API (companies, contacts, deals). Mirrors Backend/src/domain/enums.ts and
// the services' *ToDto functions; keep in sync by hand. Lives beside the old lead types
// until P7d2 removes them.
import type {
  AutomationMode,
  CallConnectedOutcome,
  CallNotConnectedReason,
  LeadLossReason,
  ObjectionType,
  PipelineStage,
  ResponseState,
} from "./lead";
import type { TaskType } from "./task";

export const LIFECYCLE_STAGES = [
  "prospect",
  "contacted",
  "engaged",
  "qualified",
  "customer",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const CONTACT_STATUSES = ["active", "do_not_contact", "merged"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const DEAL_OUTCOMES = ["open", "won", "lost", "nurture", "discarded"] as const;
export type DealOutcome = (typeof DEAL_OUTCOMES)[number];

/** Backend LEAD_SOURCES ("brain" is set by the brain only). */
export const CONTACT_SOURCES = [
  "linkedin",
  "email",
  "cold_call",
  "referral",
  "event",
  "inbound_form",
  "other",
] as const;

export type EmailStatus = "sent" | "delivered" | "opened" | "replied" | "bounced" | "unsubscribed";
export type CallSource = "human" | "ai";
export type ActorSource = "user" | "system" | "automation" | "brain";
export type TaskOrigin = "manual" | "automation";

/** List endpoints are paginated. */
export interface Paged<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Company {
  id: string;
  name: string;
  domain?: string;
  website?: string;
  industry?: string;
  phone?: string;
  city?: string;
  country?: string;
  location?: string;
  headcount?: number;
  linkedinUrl?: string;
  ownerId?: string;
  ownerName?: string;
  source?: string;
  contactCount: number;
  openDealCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  companyId?: string;
  companyName?: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  phoneE164?: string;
  linkedinUrl?: string;
  country?: string;
  location?: string;
  ownerId?: string;
  ownerName?: string;
  source: string;
  status: ContactStatus;
  doNotContact: boolean;
  dncReason?: string;
  dncBy?: string;
  dncAt?: string;
  lifecycleStage: LifecycleStage;
  lifecycleChangedAt: string;
  mergedIntoContactId?: string;
  openDealId?: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  contactId: string;
  contactName: string;
  email?: string;
  phone?: string;
  contactStatus: ContactStatus;
  doNotContact: boolean;
  lifecycleStage: LifecycleStage;
  companyId?: string;
  companyName?: string;
  ownerId?: string;
  ownerName?: string;
  serviceInterest?: string;
  stage: PipelineStage;
  outcome: DealOutcome;
  automationMode: AutomationMode;
  responseState: ResponseState;
  objectionType?: ObjectionType;
  interestedLaterReason?: string;
  interestedLaterRestartAt?: string;
  interestedLaterNextAction?: string;
  interestedLaterDecisionOwner?: string;
  lossReason?: LeadLossReason;
  lossNotes?: string;
  nextAction: {
    taskId: string;
    type: TaskType;
    title: string;
    dueAt: string;
    ownerId?: string;
    origin: TaskOrigin;
  } | null;
  lastActivityAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A human or AI call on a contact. */
export interface ContactCall {
  id: string;
  dealId?: string;
  source: CallSource;
  salespersonId?: string;
  salespersonName?: string;
  connected: boolean;
  notConnectedReason?: CallNotConnectedReason;
  connectedOutcome?: CallConnectedOutcome;
  aiOutcome?: string;
  direction?: "outbound" | "inbound";
  notes?: string;
  callbackDueAt?: string;
  at: string;
  durationSeconds?: number;
  summary?: string;
  sentiment?: string;
  transcript?: string;
  recordingUrl?: string;
}

/** One campaign email to a contact; status is the furthest event so far. */
export interface EmailActivity {
  id: string;
  dealId?: string;
  campaignRef?: string;
  campaignName?: string;
  step?: number;
  subject?: string;
  status: EmailStatus;
  replyText?: string;
  sentAt?: string;
  deliveredAt?: string;
  openedAt?: string;
  repliedAt?: string;
  bouncedAt?: string;
  unsubscribedAt?: string;
}

export interface CrmTimelineEvent {
  id: string;
  companyId?: string;
  contactId?: string;
  dealId?: string;
  at: string;
  kind: string;
  title: string;
  detail?: string;
  actor: string;
  actorId?: string;
  source: ActorSource;
  relatedTaskId?: string;
  relatedMeetingId?: string;
  relatedProposalId?: string;
  relatedCallId?: string;
  relatedWorkflowRunId?: string;
  metadata?: Record<string, unknown>;
}

export interface StageCount<S extends string> {
  stage: S;
  count: number;
}

export interface DashboardSummary {
  lifecycleFunnel: StageCount<LifecycleStage>[];
  openDealsByStage: StageCount<PipelineStage>[];
  dealsThisMonth: { won: number; lost: number };
  activityThisWeek: {
    aiCalls: number;
    humanCalls: number;
    emailsSent: number;
    emailsReplied: number;
  };
  tasks: { dueToday: number; overdue: number };
  openDealsMissingNextAction: number;
  meetingsToday: number;
  proposalsAwaitingDecision: number;
  todaysQueue: {
    id: string;
    dealId?: string;
    contactId?: string;
    contactName?: string;
    title: string;
    type: TaskType;
    dueAt: string;
  }[];
}

export interface ContactNote {
  id: string;
  dealId?: string;
  author: string;
  body: string;
  at: string;
}

export interface LogCallResult {
  call: ContactCall;
  contact: Contact;
  /** The deal the call was routed to: the open one, a reopened nurture deal, or a new one. */
  deal: Deal | null;
  workflowTrigger?: string;
  promptScheduleMeeting?: boolean;
}

export interface ImportContactsResult {
  created: string[];
  duplicates: { rowNumber: number; reason: string }[];
  failed: { rowNumber: number; reason: string }[];
  totalRows: number;
}
