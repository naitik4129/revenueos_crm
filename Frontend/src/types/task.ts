export type TaskType =
  | "Call"
  | "Follow-up"
  | "Send Information"
  | "Schedule Meeting"
  | "Proposal Follow-up"
  | "General Task";

export const TASK_TYPES: TaskType[] = [
  "Call",
  "Follow-up",
  "Send Information",
  "Schedule Meeting",
  "Proposal Follow-up",
  "General Task",
];

export interface Task {
  id: string;
  leadId: string;
  ownerId: string;
  type: TaskType;
  title: string;
  dueAt: string;
  done: boolean;
  origin: "Manual" | "Automation";
}
