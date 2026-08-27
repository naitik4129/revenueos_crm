export type WorkflowTrigger =
  | "Call Not Connected"
  | "Call Outcome = Maybe"
  | "Call Outcome = Negative"
  | "Proposal Pending"
  | "Manual Enrollment";

export const WORKFLOW_TRIGGERS: WorkflowTrigger[] = [
  "Call Not Connected",
  "Call Outcome = Maybe",
  "Call Outcome = Negative",
  "Proposal Pending",
  "Manual Enrollment",
];

export type StepAction =
  | "Send Email"
  | "Send WhatsApp"
  | "Create Call Task"
  | "Create Follow-up Task"
  | "Change Lead Stage"
  | "Stop Workflow";

export const STEP_ACTIONS: StepAction[] = [
  "Send Email",
  "Send WhatsApp",
  "Create Call Task",
  "Create Follow-up Task",
  "Change Lead Stage",
  "Stop Workflow",
];

export interface WorkflowStep {
  id: string;
  delayDays: number;
  action: StepAction;
  /** Template id for Send Email / Send WhatsApp */
  templateId?: string | undefined;
  /** Task title or target stage, depending on the action */
  config?: string | undefined;
  enabled: boolean;
}

export type VersionStatus = "Draft" | "Published" | "Previous";

export interface WorkflowVersion {
  version: number;
  status: VersionStatus;
  createdBy: string;
  createdAt: string;
  publishedAt?: string | undefined;
  steps: WorkflowStep[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  status: "Active" | "Paused";
  currentVersion: number;
  activeLeads: number;
  failures: number;
  ownerId: string;
  updatedAt: string;
  versions: WorkflowVersion[];
}

export type RunStatus = "Running" | "Waiting" | "Completed" | "Failed" | "Paused" | "Cancelled";

export interface Run {
  id: string;
  workflowId: string;
  version: number;
  leadId: string;
  currentStep: string;
  status: RunStatus;
  startedAt: string;
  nextRunAt?: string | undefined;
  lastError?: string | undefined;
}

export type TemplateType = "Email" | "WhatsApp";

export interface Template {
  id: string;
  name: string;
  type: TemplateType;
  subject: string;
  body: string;
  attachment?: string | undefined;
  active: boolean;
}
