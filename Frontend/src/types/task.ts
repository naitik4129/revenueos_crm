export const TASK_TYPES = [
  "call",
  "follow_up",
  "send_information",
  "send_case_study",
  "send_email",
  "send_whatsapp",
  "schedule_meeting",
  "confirm_meeting",
  "reschedule",
  "prepare_proposal",
  "send_proposal",
  "proposal_follow_up",
  "nurture",
  "re_engage",
  "internal_review",
  "general_task",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = "open" | "completed" | "cancelled";
export interface Task {
  id: string;
  leadId: string;
  ownerId?: string;
  ownerName?: string;
  type: TaskType;
  title: string;
  dueAt: string;
  status: TaskStatus;
  done: boolean;
  origin: "manual" | "automation";
  sourceWorkflowRunId?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
}
