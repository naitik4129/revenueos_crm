import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { InfoRow, Section, TimelineList } from "@/components/common/detail-parts";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { StatusBadge } from "@/components/common/status-badge";
import { backend } from "@/lib/backend-client";
import { fmtDate, fmtDateTime, isOverdue, money, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { nurtureTriggerForStage } from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import {
  messageFromError,
  useAutomations,
  useCrmMutation,
  useDeal,
  useDealDetail,
  useSession,
} from "@/store";
import {
  AUTOMATION_MODES,
  PIPELINE_STAGES,
  PROPOSAL_STATUSES,
  type AutomationMode,
  type Deal,
  type LeadLossReason,
  type Meeting,
  type PipelineStage,
  type Proposal,
  type ProposalStatus,
  type Task,
  type WorkflowTrigger,
} from "@/types";
import { CompanyLink } from "@/features/companies/company-link";
import { LogCallDialog } from "@/features/contacts/log-call-dialog";
import { MeetingOutcomeDialog } from "@/features/meetings/meetings-page";
import { ScheduleMeetingDialog } from "@/features/meetings/schedule-meeting-dialog";
import {
  LossReasonDialog,
  NewProposalDialog,
  SendProposalDialog,
  UploadDocumentDialog,
} from "@/features/proposals/components/proposal-dialogs";
import { DealJourneyCard } from "./deal-journey-card";
import { OutcomeDialog, TaskDialog, type OutcomeAction } from "./deal-dialogs";
import { EnrollWorkflowDialog, ScheduledFollowupTimeline } from "./scheduled-followups";

type DialogState =
  | { kind: "outcome"; action: OutcomeAction }
  | { kind: "lost" }
  | { kind: "call"; taskId?: string }
  | { kind: "enroll"; trigger?: WorkflowTrigger | undefined }
  | { kind: "task"; task?: Task }
  | { kind: "meeting"; meeting?: Meeting }
  | { kind: "meetingOutcome"; meeting: Meeting }
  | { kind: "newProposal" }
  | { kind: "upload"; proposal: Proposal }
  | { kind: "send"; proposal: Proposal }
  | { kind: "proposalLost"; proposal: Proposal; status: ProposalStatus };

type LossFields = { lossReason?: LeadLossReason | undefined; lossNotes?: string | undefined };

const TERMINAL_PROPOSAL: ProposalStatus[] = ["accepted", "rejected", "withdrawn", "expired"];

export function DealDetailPage({ dealId }: { dealId: string }) {
  const dealQuery = useDeal(dealId);
  const deal = dealQuery.data;
  const detail = useDealDetail(dealId, deal?.contactId);
  // The deal's own runs/actions; the workspace lists are paged.
  const dealRuns = detail.runs.data?.data ?? [];
  const dealActions = detail.scheduledActions.data?.data ?? [];
  const { users } = useSession();
  const { workflows } = useAutomations();
  const [tab, setTab] = useState("tasks");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [note, setNote] = useState("");
  const close = () => setDialog(null);

  const patch = useCrmMutation((input: { stage?: PipelineStage; ownerId?: string | null }) =>
    backend.deals.update(dealId, input),
  );
  const automation = useCrmMutation((mode: AutomationMode) =>
    backend.deals.setAutomation(dealId, mode),
  );
  const taskAction = useCrmMutation(
    ({ id, action }: { id: string; action: "complete" | "cancel" }) =>
      action === "complete" ? backend.tasks.complete(id) : backend.tasks.cancel(id),
  );
  const meetingSave = useCrmMutation(
    (input: {
      meeting?: Meeting | undefined;
      value: Parameters<typeof backend.meetings.create>[0];
    }) =>
      input.meeting
        ? backend.meetings.update(input.meeting.id, { ...input.value, status: "rescheduled" })
        : backend.meetings.create(input.value),
  );
  const meetingOutcome = useCrmMutation(
    ({
      id,
      outcome,
      notes,
    }: {
      id: string;
      outcome: Parameters<typeof backend.meetings.recordOutcome>[1];
      notes: string;
    }) => backend.meetings.recordOutcome(id, outcome, notes || undefined),
  );
  const proposalStatus = useCrmMutation(
    ({ id, status, lossReason, lossNotes }: { id: string; status: ProposalStatus } & LossFields) =>
      backend.proposals.setStatus(id, status, lossReason, lossNotes),
  );
  const addNote = useCrmMutation((body: string) =>
    backend.contacts.addNote(deal!.contactId, body, dealId),
  );
  const markLost = useCrmMutation(
    ({ reason, notes }: { reason: Parameters<typeof backend.deals.markLost>[1]; notes: string }) =>
      backend.deals.markLost(dealId, reason, notes || undefined),
  );
  const toastError = (error: unknown) => toast.error(messageFromError(error));

  if (dealQuery.isLoading)
    return (
      <div className="p-6">
        <LoadingBlock label="Loading deal…" />
      </div>
    );
  if (!deal)
    return (
      <div className="p-6">
        <ErrorBlock error={dealQuery.error ?? new Error("Deal not found.")} />
      </div>
    );

  const open = deal.outcome === "open";
  const contact = detail.contact.data;
  const tasks = detail.tasks.data?.data ?? [];
  const openTasks = tasks
    .filter((t) => t.status === "open")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const doneTasks = tasks.filter((t) => t.status !== "open");
  const notes = (detail.notes.data?.data ?? []).filter((n) => n.dealId === dealId);
  const workflowName = (id: string) => workflows.find((w) => w.id === id)?.name ?? "Workflow";
  const enroll = (trigger?: WorkflowTrigger) =>
    setDialog({
      kind: "enroll",
      trigger: trigger ?? nurtureTriggerForStage(deal.stage, deal.objectionType),
    });

  return (
    <div className="pb-10">
      <PageHeader
        title={deal.contactName}
        heading={
          <div>
            <Link to="/deals" className="text-xs text-muted-foreground hover:underline">
              Deals
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">
              <Link
                to="/contacts/$contactId"
                params={{ contactId: deal.contactId }}
                className="hover:underline"
              >
                {deal.contactName}
              </Link>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {deal.companyName ? (
                <CompanyLink id={deal.companyId} name={deal.companyName} />
              ) : (
                "No company"
              )}
              {deal.serviceInterest && <> · {deal.serviceInterest}</>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <StatusBadge value={deal.outcome} />
              <StatusBadge value={deal.stage} />
              <StatusBadge value={deal.automationMode} dot />
              {deal.doNotContact && <StatusBadge value="do_not_contact" />}
              {deal.closedAt && (
                <span className="text-muted-foreground">Closed {fmtDate(deal.closedAt)}</span>
              )}
              <span className="text-muted-foreground">Owner: {deal.ownerName ?? "Unassigned"}</span>
            </div>
          </div>
        }
        actions={
          <>
            <Button size="sm" disabled={!contact} onClick={() => setDialog({ kind: "call" })}>
              <Phone className="size-4" /> Log call
            </Button>
            {open ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ kind: "outcome", action: "won" })}
                >
                  Won
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "lost" })}>
                  Lost
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ kind: "outcome", action: "nurture" })}
                >
                  Nurture
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDialog({ kind: "outcome", action: "discard" })}
                >
                  Discard
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog({ kind: "outcome", action: "reopen" })}
              >
                Reopen
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {open && (
            <DealJourneyCard
              runs={dealRuns}
              scheduledActions={dealActions}
              stage={deal.stage}
              doNotContact={deal.doNotContact}
              onCallClick={() => setDialog({ kind: "call" })}
              onEnrollClick={() => enroll()}
              onMeetingClick={() => setDialog({ kind: "meeting" })}
              onProposalClick={() => setDialog({ kind: "newProposal" })}
            />
          )}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="tasks">Tasks ({openTasks.length})</TabsTrigger>
              <TabsTrigger value="meetings">Meetings</TabsTrigger>
              <TabsTrigger value="proposals">Proposals</TabsTrigger>
              <TabsTrigger value="automation">Automation</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "task" })}>
                  Add task
                </Button>
              </div>
              <Section
                query={{ ...detail.tasks, data: { data: openTasks } }}
                empty="No open tasks. Add one so the deal has a next action."
              >
                {(data) =>
                  data.data.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-wrap items-center gap-2 border-b py-3 last:border-0"
                    >
                      {deal.nextAction?.taskId === task.id && (
                        <StatusBadge value="Next action" tone="primary" />
                      )}
                      <span className="text-sm font-medium">{task.title}</span>
                      <StatusBadge value={task.type} tone="neutral" />
                      <span
                        className={cn(
                          "text-xs",
                          isOverdue(task.dueAt) ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {relDay(task.dueAt)} · {task.ownerName ?? "Unassigned"}
                      </span>
                      <span className="ml-auto flex gap-1">
                        {task.type === "call" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!contact}
                            onClick={() => setDialog({ kind: "call", taskId: task.id })}
                          >
                            Log call
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={taskAction.isPending}
                            onClick={() =>
                              taskAction.mutate(
                                { id: task.id, action: "complete" },
                                { onError: toastError },
                              )
                            }
                          >
                            Complete
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDialog({ kind: "task", task })}
                        >
                          Reschedule
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={taskAction.isPending}
                          onClick={() =>
                            taskAction.mutate(
                              { id: task.id, action: "cancel" },
                              { onError: toastError },
                            )
                          }
                        >
                          Cancel
                        </Button>
                      </span>
                    </div>
                  ))
                }
              </Section>
              {doneTasks.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Done and cancelled ({doneTasks.length})
                  </summary>
                  {doneTasks.map((task) => (
                    <div key={task.id} className="flex gap-2 py-1 text-xs text-muted-foreground">
                      <span className="line-through">{task.title}</span>
                      <StatusBadge value={task.status} />
                    </div>
                  ))}
                </details>
              )}
            </TabsContent>

            <TabsContent value="meetings" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "meeting" })}>
                  Schedule meeting
                </Button>
              </div>
              <Section query={detail.meetings} empty="No meetings yet.">
                {(data) =>
                  data.data.map((meeting) => (
                    <div
                      key={meeting.id}
                      className="flex flex-wrap items-center gap-2 border-b py-3 last:border-0"
                    >
                      <span className="text-sm font-medium">{meeting.title}</span>
                      <StatusBadge value={meeting.status} />
                      {meeting.outcome && <StatusBadge value={meeting.outcome} />}
                      <span className="text-xs text-muted-foreground">
                        {fmtDateTime(meeting.at)}
                      </span>
                      {(meeting.meetLink ?? meeting.url) && (
                        <a
                          href={meeting.meetLink ?? meeting.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          Join
                        </a>
                      )}
                      <span className="ml-auto flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={meeting.status === "completed"}
                          onClick={() => setDialog({ kind: "meeting", meeting })}
                        >
                          Reschedule
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={
                            meeting.status === "completed" || meeting.status === "cancelled"
                          }
                          onClick={() => setDialog({ kind: "meetingOutcome", meeting })}
                        >
                          Record outcome
                        </Button>
                      </span>
                    </div>
                  ))
                }
              </Section>
            </TabsContent>

            <TabsContent value="proposals" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ kind: "newProposal" })}
                >
                  New proposal
                </Button>
              </div>
              <Section query={detail.proposals} empty="No proposals yet.">
                {(data) =>
                  data.data.map((proposal) => {
                    const terminal = TERMINAL_PROPOSAL.includes(proposal.status);
                    return (
                      <div key={proposal.id} className="space-y-1.5 border-b py-3 last:border-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{proposal.title}</span>
                          {proposal.amount !== undefined && (
                            <span className="num text-sm">{money(proposal.amount)}</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {proposal.fileName ?? "No document"}
                          </span>
                          {proposal.emailSendStatus !== "not_applicable" && (
                            <span className="text-xs text-muted-foreground">
                              Email: {label(proposal.emailSendStatus)}
                            </span>
                          )}
                          {proposal.whatsappSendStatus !== "not_applicable" && (
                            <span className="text-xs text-muted-foreground">
                              WhatsApp: {label(proposal.whatsappSendStatus)}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Status of ${proposal.title}`}
                            value={proposal.status}
                            disabled={proposalStatus.isPending}
                            onChange={(e) => {
                              const status = e.target.value as ProposalStatus;
                              if (status === "rejected" || status === "expired")
                                return setDialog({ kind: "proposalLost", proposal, status });
                              proposalStatus.mutate(
                                { id: proposal.id, status },
                                {
                                  onSuccess: () => toast.success(`Proposal ${label(status)}`),
                                  onError: toastError,
                                },
                              );
                            }}
                            className="h-8 rounded-md border bg-background px-2 text-xs"
                          >
                            {PROPOSAL_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {label(s)}
                              </option>
                            ))}
                          </select>
                          {!terminal && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDialog({ kind: "upload", proposal })}
                            >
                              {proposal.fileName ? "Replace document" : "Upload document"}
                            </Button>
                          )}
                          {!terminal && proposal.fileName && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDialog({ kind: "send", proposal })}
                            >
                              Send
                            </Button>
                          )}
                          {proposal.lossReason && (
                            <span className="text-xs text-muted-foreground">
                              Loss: {label(proposal.lossReason)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                }
              </Section>
            </TabsContent>

            <TabsContent value="automation" className="mt-4 space-y-3">
              {open && (
                <ScheduledFollowupTimeline
                  runs={dealRuns}
                  scheduledActions={dealActions}
                  doNotContact={deal.doNotContact}
                  onEnrollClick={() => enroll()}
                />
              )}
              <Section query={detail.runs} empty="No workflow runs for this deal.">
                {(data) =>
                  data.data.map((run) => (
                    <div
                      key={run.id}
                      className="flex flex-wrap items-center gap-2 border-b py-3 last:border-0"
                    >
                      <span className="text-sm font-medium">
                        {workflowName(run.workflowId)} V{run.version}
                      </span>
                      <StatusBadge value={run.status} />
                      <span className="text-xs text-muted-foreground">
                        Started {relDay(run.startedAt)}
                      </span>
                      {run.nextRunAt && (
                        <span className="text-xs text-muted-foreground">
                          · Next {relDay(run.nextRunAt)}
                        </span>
                      )}
                      {run.lastError && (
                        <span className="text-xs text-destructive">{run.lastError}</span>
                      )}
                    </div>
                  ))
                }
              </Section>
            </TabsContent>

            <TabsContent value="timeline" className="mt-4">
              <TimelineList query={detail.timeline} />
            </TabsContent>

            <TabsContent value="notes" className="mt-4 space-y-3">
              <Card>
                <CardContent className="space-y-2 py-4">
                  <Textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note to this deal…"
                    aria-label="New note"
                  />
                  <Button
                    size="sm"
                    disabled={!note.trim() || addNote.isPending}
                    onClick={() =>
                      addNote.mutate(note.trim(), {
                        onSuccess: () => {
                          setNote("");
                          toast.success("Note added");
                        },
                        onError: toastError,
                      })
                    }
                  >
                    Add note
                  </Button>
                </CardContent>
              </Card>
              <Section
                query={{ ...detail.notes, data: { data: notes } }}
                empty="No notes on this deal yet."
              >
                {(data) =>
                  data.data.map((item) => (
                    <div key={item.id} className="border-b py-3 last:border-0">
                      <div className="whitespace-pre-wrap text-sm">{item.body}</div>
                      <div className="pt-1 text-xs text-muted-foreground">
                        {item.author} · {relDay(item.at)}
                      </div>
                    </div>
                  ))
                }
              </Section>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Deal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Field label="Stage">
                <select
                  aria-label="Stage"
                  value={deal.stage}
                  disabled={!open || patch.isPending}
                  onChange={(e) =>
                    patch.mutate(
                      { stage: e.target.value as PipelineStage },
                      { onSuccess: () => toast.success("Stage changed"), onError: toastError },
                    )
                  }
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Owner">
                <select
                  aria-label="Owner"
                  value={deal.ownerId ?? ""}
                  disabled={patch.isPending}
                  onChange={(e) =>
                    patch.mutate(
                      { ownerId: e.target.value || null },
                      { onSuccess: () => toast.success("Owner changed"), onError: toastError },
                    )
                  }
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Automation">
                <div className="flex gap-2">
                  <select
                    aria-label="Automation mode"
                    value={deal.automationMode}
                    disabled={automation.isPending}
                    onChange={(e) =>
                      automation.mutate(e.target.value as AutomationMode, {
                        onSuccess: () => toast.success("Automation changed"),
                        onError: toastError,
                      })
                    }
                    className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
                  >
                    {AUTOMATION_MODES.map((m) => (
                      <option key={m} value={m}>
                        {label(m)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={deal.doNotContact}
                    onClick={() => enroll()}
                  >
                    Enroll
                  </Button>
                </div>
              </Field>
              <InfoRow name="Response" value={label(deal.responseState)} />
              <InfoRow name="Lifecycle" value={label(deal.lifecycleStage)} />
              <InfoRow name="Last activity" value={relDay(deal.lastActivityAt)} />
              <InfoRow name="Created" value={fmtDateTime(deal.createdAt)} />
              {deal.closedAt && <InfoRow name="Closed" value={fmtDateTime(deal.closedAt)} />}
              {deal.lossReason && <InfoRow name="Loss reason" value={label(deal.lossReason)} />}
              {deal.lossNotes && <p className="text-xs text-muted-foreground">{deal.lossNotes}</p>}
              {deal.objectionType && <InfoRow name="Objection" value={label(deal.objectionType)} />}
            </CardContent>
          </Card>

          {deal.interestedLaterReason || deal.interestedLaterRestartAt ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Interested - Later</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <InfoRow name="Reason" value={deal.interestedLaterReason} />
                <InfoRow
                  name="Restart"
                  value={deal.interestedLaterRestartAt && fmtDate(deal.interestedLaterRestartAt)}
                />
                <InfoRow name="Next action" value={deal.interestedLaterNextAction} />
                <InfoRow name="Decision owner" value={deal.interestedLaterDecisionOwner} />
              </CardContent>
            </Card>
          ) : null}

          {contact && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <InfoRow name="Email" value={contact.email} />
                <InfoRow name="Phone" value={contact.phone} />
                <InfoRow name="Job title" value={contact.jobTitle} />
                <InfoRow name="Status" value={label(contact.status)} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialogs
        deal={deal}
        dialog={dialog}
        close={close}
        contact={contact}
        onCallDone={(result) => {
          if (result.promptScheduleMeeting) setDialog({ kind: "meeting" });
          else if (result.workflowTrigger) enroll(result.workflowTrigger as WorkflowTrigger);
        }}
        onLost={(reason, notes) =>
          markLost.mutateAsync({ reason, notes }).then(() => toast.success("Deal marked lost"))
        }
        onMeetingSave={(meeting, value) =>
          meetingSave.mutate(
            { meeting, value },
            {
              onSuccess: () => toast.success(meeting ? "Meeting rescheduled" : "Meeting scheduled"),
              onError: toastError,
            },
          )
        }
        onMeetingOutcome={(id, outcome, notes) =>
          meetingOutcome.mutate(
            { id, outcome, notes },
            {
              onSuccess: () => {
                toast.success("Outcome recorded");
                close();
              },
              onError: toastError,
            },
          )
        }
        meetingSaving={meetingSave.isPending}
        onProposalLost={(proposal, status, reason, notes) =>
          proposalStatus
            .mutateAsync({
              id: proposal.id,
              status,
              lossReason: reason,
              lossNotes: notes || undefined,
            })
            .then(() => toast.success(`Proposal ${label(status)}`))
        }
      />
    </div>
  );
}

function Field({ label: text, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{text}</div>
      {children}
    </div>
  );
}

/** Every dialog on the page; each is mounted only while open, so it starts fresh. */
function Dialogs({
  deal,
  dialog,
  close,
  contact,
  onCallDone,
  onLost,
  onMeetingSave,
  onMeetingOutcome,
  meetingSaving,
  onProposalLost,
}: {
  deal: Deal;
  dialog: DialogState | null;
  close: () => void;
  contact: ReturnType<typeof useDealDetail>["contact"]["data"];
  onCallDone: Parameters<typeof LogCallDialog>[0]["onDone"] & {};
  onLost: Parameters<typeof LossReasonDialog>[0]["onConfirm"];
  onMeetingSave: (
    meeting: Meeting | undefined,
    value: Parameters<typeof backend.meetings.create>[0],
  ) => void;
  onMeetingOutcome: (
    id: string,
    outcome: Parameters<typeof backend.meetings.recordOutcome>[1],
    notes: string,
  ) => void;
  meetingSaving: boolean;
  onProposalLost: (
    proposal: Proposal,
    status: ProposalStatus,
    ...args: Parameters<Parameters<typeof LossReasonDialog>[0]["onConfirm"]>
  ) => Promise<unknown>;
}) {
  if (!dialog) return null;
  const onOpenChange = (open: boolean) => !open && close();
  switch (dialog.kind) {
    case "outcome":
      return <OutcomeDialog deal={deal} action={dialog.action} onOpenChange={onOpenChange} />;
    case "lost":
      return (
        <LossReasonDialog
          title="Mark deal lost"
          confirm="Mark lost"
          onConfirm={onLost}
          onOpenChange={onOpenChange}
        />
      );
    case "call":
      return contact ? (
        <LogCallDialog
          contact={contact}
          dealIds={[deal.id]}
          open
          onOpenChange={onOpenChange}
          taskId={dialog.taskId}
          fromDealId={deal.id}
          onDone={onCallDone}
        />
      ) : null;
    case "enroll":
      return (
        <EnrollWorkflowDialog
          dealId={deal.id}
          open
          onOpenChange={onOpenChange}
          {...(dialog.trigger ? { triggerFilter: dialog.trigger } : {})}
        />
      );
    case "task":
      return (
        <TaskDialog
          deal={deal}
          {...(dialog.task ? { task: dialog.task } : {})}
          onOpenChange={onOpenChange}
        />
      );
    case "meeting":
      return (
        <ScheduleMeetingDialog
          dealId={deal.id}
          open
          meeting={dialog.meeting ?? null}
          isSaving={meetingSaving}
          onOpenChange={onOpenChange}
          onSave={(value) => onMeetingSave(dialog.meeting, value)}
        />
      );
    case "meetingOutcome":
      return (
        <MeetingOutcomeDialog
          open
          onOpenChange={onOpenChange}
          onSave={(outcome, notes) => onMeetingOutcome(dialog.meeting.id, outcome, notes)}
        />
      );
    case "newProposal":
      return <NewProposalDialog dealId={deal.id} onOpenChange={onOpenChange} />;
    case "upload":
      return <UploadDocumentDialog proposal={dialog.proposal} onOpenChange={onOpenChange} />;
    case "send":
      return <SendProposalDialog proposal={dialog.proposal} onOpenChange={onOpenChange} />;
    case "proposalLost":
      return (
        <LossReasonDialog
          title={`Mark proposal ${label(dialog.status)}`}
          confirm={`Mark ${label(dialog.status)}`}
          onConfirm={(reason, notes) =>
            onProposalLost(dialog.proposal, dialog.status, reason, notes)
          }
          onOpenChange={onOpenChange}
        />
      );
  }
}
