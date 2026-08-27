export type MeetingStatus = "Scheduled" | "Completed" | "Rescheduled" | "Cancelled" | "No-show";

export const MEETING_STATUSES: MeetingStatus[] = [
  "Scheduled",
  "Completed",
  "Rescheduled",
  "Cancelled",
  "No-show",
];

export type MeetingOutcome =
  | "Proposal Required"
  | "Follow-up Required"
  | "Second Meeting"
  | "Not Interested"
  | "No Proposal Required";

export const MEETING_OUTCOMES: MeetingOutcome[] = [
  "Proposal Required",
  "Follow-up Required",
  "Second Meeting",
  "Not Interested",
  "No Proposal Required",
];

export interface Meeting {
  id: string;
  leadId: string;
  ownerId: string;
  title: string;
  at: string;
  durationMin: number;
  url: string;
  status: MeetingStatus;
  outcome?: MeetingOutcome | undefined;
  notes?: string | undefined;
}
