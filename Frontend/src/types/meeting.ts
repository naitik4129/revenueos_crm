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
export type CalendarSyncStatus = "not_applicable" | "pending" | "synced" | "failed";
export interface Meeting {
  id: string;
  dealId: string;
  ownerId?: string;
  ownerName?: string;
  title: string;
  at: string;
  durationMin: number;
  url?: string;
  status: MeetingStatus;
  outcome?: MeetingOutcome;
  notes?: string;
  meetLink?: string;
  calendarSyncStatus: CalendarSyncStatus;
  calendarSyncError?: string;
  createdAt: string;
  updatedAt: string;
}
