/**
 * `call_outcome_maybe`/`call_outcome_negative` intentionally omitted (retired).
 * `meeting_highly_interested`/`meeting_proposal_requested`/`meeting_not_a_fit` are the dedicated
 * triggers for those meeting outcomes; `needs_internal_discussion` reuses `objection_internal_approval`.
 */
export const WORKFLOW_TRIGGERS = [
  "deal_created",
  "meeting_scheduled",
  "meeting_agreed",
  "call_not_connected",
  "call_outcome_interested_later",
  "call_outcome_future_possibility",
  "call_outcome_information_requested",
  "objection_commission_only",
  "objection_internal_hiring",
  "objection_existing_team",
  "objection_budget_price",
  "objection_internal_approval",
  "meeting_needs_more_information",
  "meeting_not_ready",
  "meeting_highly_interested",
  "meeting_proposal_requested",
  "meeting_not_a_fit",
  "proposal_pending",
  "manual_enrollment",
] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];
export const STEP_ACTIONS = [
  "send_email",
  "send_whatsapp",
  "create_call_task",
  "create_follow_up_task",
  "change_lead_stage",
  "stop_workflow",
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];
export interface WorkflowStep {
  id: string;
  order: number;
  delayDays: number;
  action: StepAction;
  templateId?: string | undefined;
  config?: string | undefined;
  enabled: boolean;
}
export type VersionStatus = "draft" | "published" | "previous";
export interface WorkflowVersion {
  version: number;
  status: VersionStatus;
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
  steps: WorkflowStep[];
}
export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  status: "active" | "paused";
  currentVersion: number;
  activeLeads: number;
  failures: number;
  ownerId?: string;
  updatedAt: string;
  versions: WorkflowVersion[];
}
export const RUN_STATUSES = [
  "running",
  "waiting",
  "completed",
  "failed",
  "paused",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export interface Run {
  id: string;
  workflowId: string;
  version: number;
  dealId: string;
  contactId: string;
  currentStep?: string;
  status: RunStatus;
  startedAt: string;
  nextRunAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  lastError?: string;
}
export type TemplateType = "email" | "whatsapp";
export interface TemplateAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string | null;
}
export interface Template {
  id: string;
  name: string;
  type: TemplateType;
  subject: string;
  body: string;
  attachments: TemplateAttachment[];
  active: boolean;
  isDefaultMeetingScheduled: boolean;
}
export const SCHEDULED_ACTION_STATUSES = [
  "pending",
  "due",
  "executing",
  "completed",
  "failed",
  "cancelled",
  "paused",
  "skipped",
] as const;
export type ScheduledActionStatus = (typeof SCHEDULED_ACTION_STATUSES)[number];
export interface ScheduledAction {
  id: string;
  dealId: string;
  workflowRunId: string;
  workflowStepId: string;
  actionType: StepAction;
  scheduledFor: string;
  status: ScheduledActionStatus;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  lastError?: string;
  executedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
}
