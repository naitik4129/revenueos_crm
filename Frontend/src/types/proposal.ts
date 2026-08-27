export type ProposalStatus = "Draft" | "Sent" | "Pending" | "Accepted" | "Rejected";

export const PROPOSAL_STATUSES: ProposalStatus[] = [
  "Draft",
  "Sent",
  "Pending",
  "Accepted",
  "Rejected",
];

export interface Proposal {
  id: string;
  leadId: string;
  ownerId: string;
  title: string;
  fileName: string;
  amount?: number | undefined;
  status: ProposalStatus;
  sentDate?: string | undefined;
  followUpDate?: string | undefined;
  nextAction?: string | undefined;
  notes?: string | undefined;
  updatedAt: string;
}
