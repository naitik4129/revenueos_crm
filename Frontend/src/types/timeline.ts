export interface TimelineEvent {
  id: string;
  leadId: string;
  at: string;
  kind: string;
  title: string;
  actor: string;
  actorId?: string;
  source: "manual" | "automation" | "system";
  detail?: string;
  relatedTaskId?: string;
  relatedMeetingId?: string;
  relatedProposalId?: string;
  relatedCallId?: string;
  relatedWorkflowRunId?: string;
  metadata?: Record<string, unknown>;
}
