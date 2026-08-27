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
export interface Meeting {
  id: string;
  leadId: string;
  ownerId?: string;
  ownerName?: string;
  title: string;
  at: string;
  durationMin: number;
  url?: string;
  status: MeetingStatus;
  outcome?: MeetingOutcome;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
