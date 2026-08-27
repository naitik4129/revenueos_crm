import { cn } from "@/lib/utils";

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
  // pipeline
  New: "info",
  "Ready for Call": "info",
  "Not Connected Nurture": "warning",
  "Maybe Nurture": "warning",
  "Negative Nurture": "muted",
  "Meeting Scheduling": "primary",
  "Meeting Scheduled": "primary",
  "Proposal Preparation": "primary",
  "Proposal Pending": "warning",
  "Long-Term Nurture": "muted",
  Won: "success",
  Lost: "danger",
  Discarded: "muted",
  "Do Not Contact": "danger",
  // automation
  Active: "success",
  Paused: "warning",
  Manual: "info",
  Stopped: "muted",
  Inactive: "muted",
  // runs
  Running: "primary",
  Waiting: "info",
  Completed: "success",
  Failed: "danger",
  Cancelled: "muted",
  // meetings
  Scheduled: "primary",
  Rescheduled: "warning",
  "No-show": "danger",
  // proposals
  Draft: "muted",
  Sent: "primary",
  Pending: "warning",
  Accepted: "success",
  Rejected: "danger",
  // versions / integrations
  Published: "success",
  Previous: "info",
  Connected: "success",
  "Not Connected": "muted",
  Planned: "info",
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
      {value}
    </span>
  );
}
