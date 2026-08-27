import type { TaskType } from "./task";

export type PipelineStage =
  | "New"
  | "Ready for Call"
  | "Not Connected Nurture"
  | "Maybe Nurture"
  | "Negative Nurture"
  | "Meeting Scheduling"
  | "Meeting Scheduled"
  | "Proposal Preparation"
  | "Proposal Pending"
  | "Long-Term Nurture"
  | "Won"
  | "Lost"
  | "Discarded";

export const PIPELINE_STAGES: PipelineStage[] = [
  "New",
  "Ready for Call",
  "Not Connected Nurture",
  "Maybe Nurture",
  "Negative Nurture",
  "Meeting Scheduling",
  "Meeting Scheduled",
  "Proposal Preparation",
  "Proposal Pending",
  "Long-Term Nurture",
  "Won",
  "Lost",
  "Discarded",
];

export const CLOSED_STAGES: PipelineStage[] = ["Won", "Lost", "Discarded"];

export type AutomationMode = "Active" | "Paused" | "Manual" | "Stopped";

export type LeadSource =
  "LinkedIn" | "Website" | "Email" | "Cold Call" | "Referral" | "Event" | "Inbound Form";

export const LEAD_SOURCES: LeadSource[] = [
  "LinkedIn",
  "Website",
  "Email",
  "Cold Call",
  "Referral",
  "Event",
  "Inbound Form",
];

export interface NextAction {
  type: TaskType;
  title: string;
  dueAt: string;
  ownerId: string;
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
  ownerId: string;
  stage: PipelineStage;
  automation: AutomationMode;
  doNotContact: boolean;
  dncReason?: string | undefined;
  dncBy?: string | undefined;
  dncAt?: string | undefined;
  lastActivity: string;
  nextAction: NextAction | null;
  createdAt: string;
  notes: LeadNote[];
}

export type CallOutcome =
  "Positive" | "Maybe" | "Negative" | "Callback Requested" | "Do Not Contact";

export const CALL_OUTCOMES: CallOutcome[] = [
  "Positive",
  "Maybe",
  "Negative",
  "Callback Requested",
  "Do Not Contact",
];

export const NOT_CONNECTED_REASONS = [
  "No Answer",
  "Busy",
  "Switched Off / Unreachable",
  "Wrong Number / Invalid Number",
  "Other",
] as const;
