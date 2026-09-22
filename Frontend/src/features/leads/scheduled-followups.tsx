import { useState } from "react";
import { toast } from "sonner";
import { Bot, Check, Clock3, Mail, MessageSquare, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/format";
import { label } from "@/lib/labels";
import { stepsWithCumulativeDay } from "@/lib/workflow-timeline";
import { findCurrentStep } from "@/lib/workflow-timeline";
import { messageFromError, useAutomations } from "@/store";
import type { Run, ScheduledAction, WorkflowTrigger } from "@/types";

/**
 * Manual "enroll this lead in a workflow" dialog — controlled like
 * LogCallDialog, so the empty-state prompt below, the Automation tab's
 * "Workflow runs" card, and the Lead Journey card's post-call-outcome
 * prompt can all open the same instance. When `triggerFilter` is set (the
 * lead just moved into a nurture stage from a call outcome), the workflow
 * list is narrowed to that trigger and pre-selected when there's exactly
 * one match — the rep still has to click Enroll, nothing is auto-applied.
 */
export function EnrollWorkflowDialog({
  leadId,
  open,
  onOpenChange,
  triggerFilter,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerFilter?: WorkflowTrigger;
}) {
  const automationStore = useAutomations();
  const [workflowId, setWorkflowId] = useState("");
  const [reason, setReason] = useState("");

  const active = automationStore.workflows.filter(
    (workflow) =>
      workflow.status === "active" &&
      workflow.versions.some((version) => version.status === "published"),
  );
  const matchingTrigger = triggerFilter
    ? active.filter((workflow) => workflow.trigger === triggerFilter)
    : [];
  const enrollable = matchingTrigger.length > 0 ? matchingTrigger : active;

  const loadedFor = `${open}:${triggerFilter ?? ""}`;
  const [lastLoadedFor, setLastLoadedFor] = useState("");
  if (open && lastLoadedFor !== loadedFor) {
    setLastLoadedFor(loadedFor);
    setWorkflowId(matchingTrigger.length === 1 ? matchingTrigger[0]!.id : "");
    setReason("");
  }
  if (!open && lastLoadedFor !== "") setLastLoadedFor("");

  const submit = async () => {
    if (!workflowId) return;
    try {
      await automationStore.enrollLead(leadId, workflowId, reason.trim() || undefined);
      toast.success("Lead enrolled in workflow");
      setWorkflowId("");
      setReason("");
      onOpenChange(false);
    } catch (error) {
      toast.error(messageFromError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enroll in workflow</DialogTitle>
          {triggerFilter && (
            <DialogDescription>
              This lead just moved to nurture - pick the workflow to enroll them in.
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Workflow</Label>
            <Select value={workflowId} onValueChange={setWorkflowId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a workflow" />
              </SelectTrigger>
              <SelectContent>
                {enrollable.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {enrollable.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No active, published workflows available yet.
              </p>
            )}
            {triggerFilter && matchingTrigger.length === 0 && active.length > 0 && (
              <p className="text-xs text-muted-foreground">
                No workflow is configured for this outcome specifically - showing all active
                workflows instead.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="Why this lead is going into this workflow"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!workflowId}>
            Enroll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CHANNEL_ICON: Record<string, typeof Mail> = {
  send_email: Mail,
  send_whatsapp: MessageSquare,
};

function StepRow({
  order,
  day,
  actionType,
  templateName,
  action,
  isNext,
  estimatedDate,
}: {
  order: number;
  day: number;
  actionType: string;
  /** Name of the email/WhatsApp template this step sends, when it's a messaging step with a template set. */
  templateName?: string | undefined;
  action: ScheduledAction | undefined;
  isNext: boolean;
  /** Best-effort projected send date/time for a step that hasn't been scheduled yet (no ScheduledAction row). */
  estimatedDate?: string | undefined;
}) {
  const ChannelIcon = CHANNEL_ICON[actionType] ?? Bot;

  let icon = <Clock3 className="size-4 text-muted-foreground" />;
  let tone = "border-border";
  let statusText = "Upcoming";
  let detail = `Day ${day} · ${label(actionType)}`;

  if (action?.status === "completed") {
    icon = <Check className="size-4 text-success" />;
    tone = "border-success/30 bg-success/5";
    statusText = "Sent";
    detail = `${fmtDateTime(action.executedAt)} · ${label(actionType)}`;
  } else if (action?.status === "failed") {
    icon = <TriangleAlert className="size-4 text-destructive" />;
    tone = "border-destructive/30 bg-destructive/5";
    statusText = "Failed";
    detail = action.lastError ?? label(actionType);
  } else if (action?.status === "skipped" || action?.status === "cancelled") {
    icon = <X className="size-4 text-muted-foreground" />;
    tone = "border-border opacity-70";
    statusText = action.status === "cancelled" ? "Cancelled" : "Skipped";
    detail = action.cancelReason ?? action.lastError ?? label(actionType);
  } else if (action) {
    // pending / due / executing
    icon = <Clock3 className="size-4 text-info" />;
    tone = "border-info/40 bg-info/5";
    statusText = isNext ? "Next up" : "Scheduled";
    detail = `${fmtDateTime(action.scheduledFor)} · ${label(actionType)}`;
  } else if (estimatedDate) {
    detail = `Day ${day} · Est. ${fmtDateTime(estimatedDate)} · ${label(actionType)}`;
    if (!isNext) tone = "opacity-60";
  } else if (!isNext) {
    tone = "opacity-60";
  }

  return (
    <div className={cn("flex items-center gap-3 rounded-md border px-3 py-2", tone)}>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
        {icon}
      </div>
      <ChannelIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          Step {order + 1} · {statusText}
        </div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
        {templateName && (
          <div className="truncate text-xs text-muted-foreground/80">Template: {templateName}</div>
        )}
      </div>
    </div>
  );
}

/**
 * "At a glance" view of a lead's nurture sequence: which messages already
 * went out, and exactly when the next one is due — assembled entirely from
 * data useAutomations() already loads (workflows+steps, runs, scheduled
 * actions), no extra requests.
 */
/** How many upcoming steps the card shows inline before collapsing the rest behind "View all". */
const VISIBLE_STEP_COUNT = 2;

export function ScheduledFollowupTimeline({
  leadId,
  doNotContact,
  onEnrollClick,
}: {
  leadId: string;
  doNotContact: boolean;
  onEnrollClick: () => void;
}) {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const automationStore = useAutomations();
  const leadRuns = automationStore.runs.filter((run: Run) => run.leadId === leadId);
  const nonTerminalRun = leadRuns.find((run) =>
    ["running", "waiting", "paused"].includes(run.status),
  );
  // Fall back to the most recent run (even a completed/cancelled one) so
  // there's still useful history to show — but whether the enroll shortcut
  // appears is driven by nonTerminalRun specifically, not by "any run ever",
  // so it doesn't disappear forever the moment a lead's first workflow ends.
  const displayRun =
    nonTerminalRun ?? leadRuns.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

  const enrollButton = (
    <Button size="sm" variant="outline" disabled={doNotContact} onClick={onEnrollClick}>
      Enroll in workflow
    </Button>
  );

  if (!displayRun) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Scheduled follow-up
            </div>
            <div className="text-sm">Not currently enrolled in a nurture workflow.</div>
          </div>
          {enrollButton}
        </CardContent>
      </Card>
    );
  }

  const workflow = automationStore.workflows.find((item) => item.id === displayRun.workflowId);
  const version = workflow?.versions.find((item) => item.version === displayRun.version);
  const rows = stepsWithCumulativeDay(version?.steps ?? []);
  const actionsForRun = automationStore.scheduledActions.filter(
    (action) => action.workflowRunId === displayRun.id,
  );
  const currentOrder = findCurrentStep(workflow, displayRun)?.order;
  const actionFor = (stepId: string) =>
    actionsForRun.find((action) => action.workflowStepId === stepId);
  const templateNameFor = (step: (typeof rows)[number]["step"]) =>
    (step.action === "send_email" || step.action === "send_whatsapp") && step.templateId
      ? automationStore.templateName(step.templateId)
      : undefined;

  // Steps beyond the next one aren't scheduled yet (the backend only creates
  // a ScheduledAction for the current step), so project their send date from
  // the next step's real scheduledFor plus the day gap between them — a
  // rough but useful estimate, clearly labeled "Est." in the row.
  const currentRow = rows.find((row) => row.step.order === currentOrder);
  const anchorIso = currentRow ? actionFor(currentRow.step.id)?.scheduledFor : undefined;
  const anchorDay = currentRow?.day;
  const estimateFor = (day: number) => {
    if (!anchorIso || anchorDay === undefined || day < anchorDay) return undefined;
    return new Date(Date.parse(anchorIso) + (day - anchorDay) * 86_400_000).toISOString();
  };

  // Show the upcoming step and the one right after it, not just "the first
  // two rows" — once earlier steps have already sent, index 0 would be
  // stale history instead of what's actually next.
  const currentIndex = rows.findIndex((row) => row.step.order === currentOrder);
  const windowStart = currentIndex >= 0 ? currentIndex : 0;
  const visibleRows = rows.slice(windowStart, windowStart + VISIBLE_STEP_COUNT);
  const hiddenCount = rows.length - visibleRows.length;
  const title = `Scheduled follow-up${workflow ? ` - ${workflow.name}` : ""}`;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <div className="flex items-center gap-2">
          <StatusText run={displayRun} />
          {!nonTerminalRun && enrollButton}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {visibleRows.map(({ step, day }) => (
          <StepRow
            key={step.id}
            order={step.order}
            day={day}
            actionType={step.action}
            templateName={templateNameFor(step)}
            action={actionFor(step.id)}
            isNext={step.order === currentOrder}
            estimatedDate={estimateFor(day)}
          />
        ))}
        {rows.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">This workflow has no steps.</p>
        )}
        {hiddenCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-auto px-1 py-1 text-xs text-muted-foreground"
            onClick={() => setViewAllOpen(true)}
          >
            View all {rows.length} steps
          </Button>
        )}
      </CardContent>
      <Dialog open={viewAllOpen} onOpenChange={setViewAllOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-1.5 overflow-y-auto">
            {rows.map(({ step, day }) => (
              <StepRow
                key={step.id}
                order={step.order}
                day={day}
                actionType={step.action}
                templateName={templateNameFor(step)}
                action={actionFor(step.id)}
                isNext={step.order === currentOrder}
                estimatedDate={estimateFor(day)}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatusText({ run }: { run: Run }) {
  if (run.status === "completed") return <span className="text-xs text-success">Completed</span>;
  if (run.status === "failed") return <span className="text-xs text-destructive">Failed</span>;
  if (run.status === "cancelled")
    return <span className="text-xs text-muted-foreground">Cancelled</span>;
  if (run.status === "paused") return <span className="text-xs text-warning">Paused</span>;
  return null;
}
