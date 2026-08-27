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
export interface Proposal {
  id: string;
  leadId: string;
  ownerId?: string;
  ownerName?: string;
  title: string;
  fileName?: string;
  amount?: number;
  currency: string;
  status: ProposalStatus;
  sentDate?: string;
  followUpDate?: string;
  nextAction?: string;
  notes?: string;
  updatedAt: string;
  createdAt: string;
}
