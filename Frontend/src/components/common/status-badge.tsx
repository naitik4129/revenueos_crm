import { cn } from "@/lib/utils";
import { label } from "@/lib/labels";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "primary" | "muted";

const toneClass: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-border",
  muted: "bg-muted text-muted-foreground border-border",
  info: "bg-info/10 text-info border-info/25",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/15 text-warning-foreground border-warning/40",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
  primary: "bg-primary/10 text-primary border-primary/25",
};

const MAP: Record<string, Tone> = {
  new: "info",
  ready_for_first_call: "info",
  contact_attempted: "info",
  not_connected_nurture: "warning",
  connected_qualifying: "info",
  interested_later: "warning",
  future_possibility: "muted",
  objection_nurture: "warning",
  meeting_scheduling: "primary",
  meeting_scheduled: "primary",
  meeting_follow_up: "primary",
  proposal_preparation: "primary",
  proposal_sent: "primary",
  proposal_decision_pending: "warning",
  negotiation: "primary",
  active: "success",
  long_term_nurture: "muted",
  won: "success",
  lost: "danger",
  discarded: "muted",
  do_not_contact: "danger",
  merged: "muted",
  paused: "warning",
  manual: "info",
  stopped: "muted",
  running: "primary",
  waiting: "info",
  completed: "success",
  failed: "danger",
  cancelled: "muted",
  scheduled: "primary",
  confirmed: "success",
  tentative: "warning",
  rescheduled: "warning",
  no_show: "danger",
  draft: "muted",
  uploaded: "info",
  ready_to_send: "info",
  sent: "primary",
  revision_requested: "warning",
  revised: "info",
  accepted: "success",
  rejected: "danger",
  withdrawn: "muted",
  expired: "danger",
  published: "success",
  previous: "info",
  pending: "warning",
  due: "warning",
  executing: "primary",
  skipped: "muted",
  // Objection types
  commission_only: "warning",
  internal_hiring: "warning",
  existing_team: "warning",
  budget_price: "warning",
  internal_approval: "warning",
  wrong_fit: "danger",
  // Meeting outcomes
  highly_interested: "success",
  needs_internal_discussion: "warning",
  needs_more_information: "info",
  not_interested: "muted",
  // Loss reasons
  price_budget: "danger",
  project_postponed: "warning",
  competitor_selected: "danger",
  management_rejected: "danger",
  no_urgency: "muted",
  no_response: "muted",
};

export function StatusBadge({
  value,
  tone,
  dot = false,
  className,
}: {
  value: string;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  const t = tone ?? MAP[value] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        toneClass[t],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {label(value)}
    </span>
  );
}
