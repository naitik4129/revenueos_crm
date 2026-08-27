export type TimelineKind =
  | "system"
  | "call"
  | "email"
  | "whatsapp"
  | "meeting"
  | "proposal"
  | "automation"
  | "stage"
  | "task"
  | "note";

export interface TimelineEvent {
  id: string;
  leadId: string;
  at: string;
  kind: TimelineKind;
  title: string;
  actor: string;
  source: "Manual" | "Automation" | "System";
  detail?: string | undefined;
}
