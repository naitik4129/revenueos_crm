export interface AppNotification {
  id: string;
  title: string;
  detail: string;
  at: string;
  kind: "info" | "warning" | "success" | "danger";
  leadId?: string | undefined;
  href?: string | undefined;
  read: boolean;
}
