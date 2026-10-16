import type { LeadLossReason } from "./crm";

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

export const PROPOSAL_EMAIL_SEND_STATUSES = [
  "not_applicable",
  "pending",
  "skipped",
  "sent",
  "failed",
] as const;
export type EmailSendStatus = (typeof PROPOSAL_EMAIL_SEND_STATUSES)[number];

export const PROPOSAL_WHATSAPP_SEND_STATUSES = [
  "not_applicable",
  "skipped",
  "queued",
  "sending",
  "sent",
  "failed",
] as const;
export type WhatsappSendStatus = (typeof PROPOSAL_WHATSAPP_SEND_STATUSES)[number];

export interface Proposal {
  id: string;
  dealId: string;
  ownerId?: string;
  ownerName?: string;
  title: string;
  fileName?: string;
  documentMimeType?: string;
  documentSizeBytes?: number;
  amount?: number;
  currency: string;
  status: ProposalStatus;
  sentDate?: string;
  followUpDate?: string;
  nextAction?: string;
  notes?: string;
  emailTemplateId?: string;
  whatsappTemplateId?: string;
  emailSendStatus: EmailSendStatus;
  emailSentAt?: string;
  emailSendError?: string;
  whatsappSendStatus: WhatsappSendStatus;
  whatsappSentAt?: string;
  whatsappSendError?: string;
  lossReason?: LeadLossReason;
  lossNotes?: string;
  updatedAt: string;
  createdAt: string;
}
