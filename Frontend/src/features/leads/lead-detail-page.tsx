import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bot,
  CalendarPlus,
  Check,
  Mail,
  MessageSquare,
  Phone,
  ShieldBan,
} from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
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
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { LogCallDialog } from "./log-call-dialog";
import { dateInputValue, toIsoFromIst } from "@/lib/dates";
import { fmtDateTime, isOverdue, money, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import {
  messageFromError,
  useAutomations,
  useLead,
  useLeads,
  useMeetings,
  useProposals,
  useSession,
  useTasks,
  useTimeline,
} from "@/store";
import {
  AUTOMATION_MODES,
  PIPELINE_STAGES,
  RESPONSE_STATES,
  TASK_TYPES,
  type AutomationMode,
  type PipelineStage,
  type ResponseState,
  type TaskType,
} from "@/types";

export function LeadDetailPage({ leadId }: { leadId: string }) {
  const detail = useLead(leadId);
  const leadActions = useLeads();
  const taskStore = useTasks();
  const { userName, users } = useSession();
  const meetingStore = useMeetings();
  const proposalStore = useProposals();
  const automationStore = useAutomations();
  const timelineStore = useTimeline(leadId);
  const lead = detail.lead;
  const [callOpen, setCallOpen] = useState(false);
  const [dncOpen, setDncOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [nextOpen, setNextOpen] = useState(false);
  const [note, setNote] = useState("");

  const activity = useMemo(
    () => timelineStore.timeline.slice().sort((a, b) => b.at.localeCompare(a.at)),
    [timelineStore.timeline],
  );
  if (detail.isLoading)
    return (
      <div className="p-6">
        <LoadingBlock label="Loading lead…" />
      </div>
    );
  if (detail.error)
    return (
      <div className="p-6">
        <ErrorBlock error={detail.error} />
      </div>
    );
  if (!lead)
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Lead not found.{" "}
        <Link to="/leads" className="underline">
          Back to leads
        </Link>
      </div>
    );

  const leadMeetings = meetingStore.meetings.filter((item) => item.leadId === leadId);
  const leadProposals = proposalStore.proposals.filter((item) => item.leadId === leadId);
  const leadTasks = taskStore.tasks.filter(
    (item) => item.leadId === leadId && item.status === "open",
  );
  const leadRuns = automationStore.runs.filter((item) => item.leadId === leadId);
  const leadActionsScheduled = automationStore.scheduledActions.filter(
    (item) => item.leadId === leadId,
  );
  const mutate = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      toast.success(success);
    } catch (error) {
      toast.error(messageFromError(error));
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={`${lead.firstName} ${lead.lastName}`}
        description={`${lead.jobTitle || "—"} · ${lead.company} · ${lead.industry || "—"}`}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link to="/leads">
                <ArrowLeft className="mr-1 size-4" /> Leads
              </Link>
            </Button>
            <Button size="sm" onClick={() => setCallOpen(true)} disabled={lead.doNotContact}>
              <Phone className="mr-1 size-4" /> Log call
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={lead.doNotContact}
              onClick={() =>
                void mutate(
                  () => leadActions.logCommunication(leadId, "email"),
                  "Email activity recorded",
                )
              }
            >
              <Mail className="mr-1 size-4" /> Email
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={lead.doNotContact}
              onClick={() =>
                void mutate(
                  () => leadActions.logCommunication(leadId, "whatsapp"),
                  "WhatsApp activity recorded",
                )
              }
            >
              <MessageSquare className="mr-1 size-4" /> WhatsApp
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDncOpen(true)}
              disabled={lead.doNotContact}
            >
              <ShieldBan className="mr-1 size-4" /> Do not contact
            </Button>
          </>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Card className={lead.nextAction ? "" : "border-warning/50 bg-warning/5"}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Next action
                </div>
                {lead.nextAction ? (
                  <>
                    <div className="text-base font-semibold">{lead.nextAction.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {label(lead.nextAction.type)} · due{" "}
                      <span className={isOverdue(lead.nextAction.dueAt) ? "text-destructive" : ""}>
                        {relDay(lead.nextAction.dueAt)}
                      </span>{" "}
                      · {lead.nextAction.ownerName ?? userName(lead.nextAction.ownerId)}
                    </div>
                  </>
                ) : (
                  <div className="text-sm">
                    {lead.doNotContact
                      ? "Lead is suppressed — no next action required."
                      : "No next action assigned. Every active lead needs one."}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {lead.nextAction && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void mutate(
                        () => taskStore.completeTask(lead.nextAction!.taskId),
                        "Next action completed",
                      )
                    }
                  >
                    <Check className="mr-1 size-4" /> Complete
                  </Button>
                )}
                <Button size="sm" onClick={() => setNextOpen(true)} disabled={lead.doNotContact}>
                  {lead.nextAction ? "Reschedule" : "Set next action"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="meetings">Meetings</TabsTrigger>
              <TabsTrigger value="proposals">Proposals</TabsTrigger>
              <TabsTrigger value="automation">Automation</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4 grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Contact</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="Phone" value={lead.phone || "—"} />
                  <Row label="Email" value={lead.email || "—"} />
                  <Row label="Company" value={lead.company} />
                  <Row label="Industry" value={lead.industry || "—"} />
                  <Row label="Interest" value={lead.serviceInterest || "—"} />
                  {detail.contactability.map((item) => (
                    <Row
                      key={item.channel}
                      label={`${label(item.channel)} status`}
                      value={label(item.status)}
                    />
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Pipeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <SelectField
                    label="Stage"
                    value={lead.pipelineStage}
                    disabled={lead.lifecycleState !== "active"}
                    options={PIPELINE_STAGES}
                    onChange={(value) =>
                      void mutate(
                        () =>
                          leadActions.updateLead(leadId, { pipelineStage: value as PipelineStage }),
                        "Stage updated",
                      )
                    }
                  />
                  <SelectField
                    label="Response"
                    value={lead.responseState}
                    options={RESPONSE_STATES}
                    onChange={(value) =>
                      void mutate(
                        () =>
                          leadActions.updateLead(leadId, { responseState: value as ResponseState }),
                        "Response state updated",
                      )
                    }
                  />
                  <SelectField
                    label="Owner"
                    value={lead.ownerId ?? ""}
                    options={users.map((user) => user.id)}
                    optionLabel={(id) => userName(id)}
                    onChange={(value) =>
                      void mutate(
                        () => leadActions.updateLead(leadId, { ownerId: value }),
                        "Owner updated",
                      )
                    }
                  />
                  <Row label="Source" value={label(lead.source)} />
                  <Row label="Created" value={fmtDateTime(lead.createdAt)} />
                </CardContent>
              </Card>
              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Open tasks</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {leadTasks.length === 0 && (
                    <p className="text-sm text-muted-foreground">No open tasks.</p>
                  )}
                  {leadTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div>
                        <div className="text-sm">{task.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {label(task.type)} · {relDay(task.dueAt)} · {label(task.origin)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void mutate(() => taskStore.completeTask(task.id), "Task completed")
                        }
                      >
                        Complete
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Activity timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  {activity.map((event) => (
                    <div key={event.id} className="flex gap-3 border-b py-3 last:border-0">
                      <div className="w-32 shrink-0 text-xs text-muted-foreground">
                        {relDay(event.at)}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{event.title}</span>
                          <StatusBadge
                            value={event.source}
                            tone={event.source === "automation" ? "primary" : "muted"}
                          />
                        </div>
                        {event.detail && (
                          <p className="pt-0.5 text-sm text-muted-foreground">{event.detail}</p>
                        )}
                        <div className="pt-0.5 text-xs text-muted-foreground">{event.actor}</div>
                      </div>
                    </div>
                  ))}
                  {activity.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No activity yet.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="meetings" className="mt-4 space-y-3">
              {leadMeetings.map((meeting) => (
                <Card key={meeting.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <div className="text-sm font-medium">{meeting.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(meeting.at)} · {meeting.durationMin} min ·{" "}
                        {meeting.ownerName ?? userName(meeting.ownerId)}
                      </div>
                      {meeting.outcome && (
                        <div className="pt-1 text-xs text-muted-foreground">
                          Outcome: {label(meeting.outcome)}
                        </div>
                      )}
                    </div>
                    <StatusBadge value={meeting.status} />
                  </CardContent>
                </Card>
              ))}
              {leadMeetings.length === 0 && (
                <Card>
                  <CardContent className="flex items-center justify-between py-6">
                    <p className="text-sm text-muted-foreground">No meetings scheduled.</p>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/meetings">
                        <CalendarPlus className="mr-1 size-4" /> Schedule
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            <TabsContent value="proposals" className="mt-4 space-y-3">
              {leadProposals.map((proposal) => (
                <Card key={proposal.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <div className="text-sm font-medium">{proposal.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {proposal.fileName || "No document"} ·{" "}
                        {proposal.amount ? money(proposal.amount) : "No value"} · updated{" "}
                        {relDay(proposal.updatedAt)}
                      </div>
                    </div>
                    <StatusBadge value={proposal.status} />
                  </CardContent>
                </Card>
              ))}
              {leadProposals.length === 0 && (
                <Card>
                  <CardContent className="py-6 text-sm text-muted-foreground">
                    No proposals uploaded.
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            <TabsContent value="automation" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Automation control</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge value={lead.automationMode} dot />
                    <span className="text-xs text-muted-foreground">
                      Backend-owned automation state.
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AUTOMATION_MODES.map((mode) => (
                      <Button
                        key={mode}
                        size="sm"
                        variant={lead.automationMode === mode ? "default" : "outline"}
                        disabled={lead.doNotContact}
                        onClick={() =>
                          void mutate(
                            () =>
                              leadActions.setAutomation(
                                leadId,
                                mode as AutomationMode,
                                "Changed from lead record",
                              ),
                            `Automation set to ${label(mode)}`,
                          )
                        }
                      >
                        {label(mode)}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Workflow runs</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {leadRuns.map((run) => {
                    const workflow = automationStore.workflows.find(
                      (item) => item.id === run.workflowId,
                    );
                    return (
                      <div key={run.id} className="rounded-md border px-3 py-2">
                        <div className="flex justify-between">
                          <div className="text-sm font-medium">
                            {workflow?.name ?? run.workflowId} · V{run.version}
                          </div>
                          <StatusBadge value={run.status} />
                        </div>
                        <div className="pt-0.5 text-xs text-muted-foreground">
                          Current step:{" "}
                          {run.currentStep
                            ? workflow?.versions
                                .find((version) => version.version === run.version)
                                ?.steps.find((step) => step.id === run.currentStep)?.action
                              ? label(
                                  workflow.versions
                                    .find((version) => version.version === run.version)
                                    ?.steps.find((step) => step.id === run.currentStep)?.action,
                                )
                              : run.currentStep
                            : "—"}
                          {run.nextRunAt ? ` · next ${relDay(run.nextRunAt)}` : ""}
                        </div>
                        {run.lastError && (
                          <div className="text-xs text-destructive">{run.lastError}</div>
                        )}
                      </div>
                    );
                  })}
                  {leadRuns.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      This lead is not in any workflow.
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Scheduled actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {leadActionsScheduled.map((action) => (
                    <div
                      key={action.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div>
                        <div className="text-sm">{label(action.actionType)}</div>
                        <div className="text-xs text-muted-foreground">
                          {relDay(action.scheduledFor)}
                          {action.lastError ? ` · ${action.lastError}` : ""}
                        </div>
                      </div>
                      <StatusBadge value={action.status} />
                    </div>
                  ))}
                  {leadActionsScheduled.length === 0 && (
                    <p className="text-sm text-muted-foreground">No scheduled actions.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="notes" className="mt-4 space-y-3">
              <Card>
                <CardContent className="space-y-2 py-4">
                  <Textarea
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Add a note…"
                  />
                  <Button
                    size="sm"
                    disabled={!note.trim() || leadActions.isPending}
                    onClick={() =>
                      void mutate(async () => {
                        await leadActions.addNote(leadId, note.trim());
                        setNote("");
                      }, "Note added")
                    }
                  >
                    Add note
                  </Button>
                </CardContent>
              </Card>
              {detail.notes.map((item) => (
                <Card key={item.id}>
                  <CardContent className="py-3">
                    <div className="text-sm">{item.body}</div>
                    <div className="pt-1 text-xs text-muted-foreground">
                      {item.author} · {relDay(item.at)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Row label="Lifecycle" value={lead.lifecycleState} badge />
              <Row label="Stage" value={lead.pipelineStage} badge />
              <Row label="Automation" value={lead.automationMode} badge />
              <Row label="Owner" value={lead.ownerName ?? userName(lead.ownerId)} />
              <Row label="Last activity" value={relDay(lead.lastActivityAt)} />
            </CardContent>
          </Card>
          {lead.doNotContact && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="py-4 text-sm">
                <div className="font-medium text-destructive">Do Not Contact</div>
                <p className="pt-1 text-xs text-muted-foreground">
                  {lead.dncReason} · {lead.dncBy} · {relDay(lead.dncAt)}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setReactivateOpen(true)}
                >
                  Remove suppression
                </Button>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Lifecycle</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {lead.lifecycleState === "active" ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void mutate(() => leadActions.setLifecycle(leadId, "won"), "Lead marked Won")
                    }
                  >
                    Won
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void mutate(
                        () => leadActions.setLifecycle(leadId, "lost"),
                        "Lead marked Lost",
                      )
                    }
                  >
                    Lost
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void mutate(
                        () => leadActions.setLifecycle(leadId, "discard"),
                        "Lead discarded",
                      )
                    }
                  >
                    Discard
                  </Button>
                </>
              ) : (
                !lead.doNotContact &&
                lead.lifecycleState !== "merged" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void mutate(
                        () => leadActions.setLifecycle(leadId, "reactivate"),
                        "Lead reactivated",
                      )
                    }
                  >
                    Reactivate
                  </Button>
                )
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-xs text-muted-foreground">
              <p>CRM data is persisted through the backend.</p>
              <p className="mt-1 flex items-center gap-1.5">
                <Bot className="size-3.5" /> Workflow execution remains in n8n.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <LogCallDialog leadId={leadId} open={callOpen} onOpenChange={setCallOpen} />
      <ReasonDialog
        open={dncOpen}
        title="Mark Do Not Contact"
        action="This stops automation and cancels inappropriate actions."
        value={reason}
        onValue={setReason}
        onOpenChange={setDncOpen}
        onConfirm={() =>
          void mutate(async () => {
            await leadActions.markDnc(leadId, reason.trim());
            setDncOpen(false);
            setReason("");
          }, "Lead suppressed")
        }
      />
      <ReasonDialog
        open={reactivateOpen}
        title="Remove Do Not Contact"
        action="A reason is required and suppression history remains preserved."
        value={reason}
        onValue={setReason}
        onOpenChange={setReactivateOpen}
        onConfirm={() =>
          void mutate(async () => {
            await leadActions.reactivateFromDnc(leadId, reason.trim());
            setReactivateOpen(false);
            setReason("");
          }, "Lead reactivated")
        }
      />
      <NextActionDialog
        open={nextOpen}
        onOpenChange={setNextOpen}
        defaultOwner={lead.ownerId ?? ""}
        {...(lead.nextAction
          ? {
              initial: {
                type: lead.nextAction.type,
                title: lead.nextAction.title,
                dueAt: lead.nextAction.dueAt,
                ownerId: lead.nextAction.ownerId ?? lead.ownerId ?? "",
              },
            }
          : {})}
        onSave={(value) =>
          void mutate(
            () =>
              lead.nextAction
                ? taskStore.updateTask(lead.nextAction.taskId, value)
                : taskStore.addTask({ leadId, ...value }),
            "Next action saved",
          )
        }
      />
    </div>
  );
}

function Row({ label: name, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{name}</span>
      {badge ? <StatusBadge value={value} /> : <span className="truncate text-sm">{value}</span>}
    </div>
  );
}
function SelectField({
  label: name,
  value,
  options,
  onChange,
  optionLabel = label,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  optionLabel?: (value: string) => string;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs">{name}</Label>
      <Select
        value={value}
        onValueChange={onChange}
        {...(disabled !== undefined ? { disabled } : {})}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function ReasonDialog({
  open,
  title,
  action,
  value,
  onValue,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  action: string;
  value: string;
  onValue: (value: string) => void;
  onOpenChange: (value: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div>
          <Label className="mb-1.5 block text-xs">Reason</Label>
          <Textarea rows={3} value={value} onChange={(event) => onValue(event.target.value)} />
          <p className="pt-2 text-xs text-muted-foreground">{action}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!value.trim()} onClick={onConfirm}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NextActionDialog({
  open,
  onOpenChange,
  defaultOwner,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  defaultOwner: string;
  initial?: { type: TaskType; title: string; dueAt: string; ownerId: string };
  onSave: (value: { type: TaskType; title: string; dueAt: string; ownerId: string }) => void;
}) {
  const { users } = useSession();
  const [type, setType] = useState<TaskType>(initial?.type ?? "call");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [due, setDue] = useState(
    initial
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
          new Date(initial.dueAt),
        )
      : dateInputValue(1),
  );
  const [owner, setOwner] = useState(initial?.ownerId ?? defaultOwner);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set next action</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <SelectField
            label="Type"
            value={type}
            options={TASK_TYPES}
            onChange={(value) => setType(value as TaskType)}
          />
          <div>
            <Label className="mb-1.5 block text-xs">Title</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Due date</Label>
            <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
          </div>
          <SelectField
            label="Owner"
            value={owner}
            options={users.map((user) => user.id)}
            optionLabel={(id) => users.find((user) => user.id === id)?.name ?? "Unassigned"}
            onChange={setOwner}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !owner}
            onClick={() => {
              onSave({ type, title: title.trim(), dueAt: toIsoFromIst(due), ownerId: owner });
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
