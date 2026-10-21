import { useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, ListChecks, Phone, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { InfoRow, Section, TimelineList } from "@/components/common/detail-parts";
import { Avatar, BackLink, CopyValue, Panel, QuickAction } from "@/components/common/record-parts";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { StatusBadge } from "@/components/common/status-badge";
import { backend } from "@/lib/backend-client";
import { fmtDate, fmtDateTime, isOverdue, money, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { nurtureTriggerForStage } from "@/lib/pipeline";
import { NATIVE_SELECT, cn } from "@/lib/utils";
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
  const detail = useDealDetail(dealId);
  // The deal's own runs/actions; the workspace lists are paged.
  const dealRuns = detail.runs.data?.data ?? [];
  const dealActions = detail.scheduledActions.data?.data ?? [];
  const { users } = useSession();
  const { workflows } = useAutomations();
  const [tab, setTab] = useState("activity");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const close = () => setDialog(null);

  const patch = useCrmMutation(
    (input: { stage?: PipelineStage; ownerId?: string | null; amount?: number | null }) =>
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
      <div className="px-6 py-4">
        <LoadingBlock label="Loading deal…" />
      </div>
    );
  if (!deal)
    return (
      <div className="px-6 py-4">
        <ErrorBlock error={dealQuery.error ?? new Error("Deal not found.")} />
      </div>
    );

  const open = deal.outcome === "open";
  const contact = detail.contact.data;
  const company = detail.company.data;
  const tasks = detail.tasks.data?.data ?? [];
  const openTasks = tasks
    .filter((t) => t.status === "open")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const doneTasks = tasks.filter((t) => t.status !== "open");
  const notes = (detail.notes.data?.data ?? []).filter((n) => n.dealId === dealId);
  const meetings = detail.meetings.data?.data ?? [];
  const proposals = detail.proposals.data?.data ?? [];
  const workflowName = (id: string) => workflows.find((w) => w.id === id)?.name ?? "Workflow";
  const enroll = (trigger?: WorkflowTrigger) =>
    setDialog({
      kind: "enroll",
      trigger: trigger ?? nurtureTriggerForStage(deal.stage, deal.objectionType),
    });
  const writeNote = () => {
    setTab("activity");
    // The note box mounts with the Activity tab; focus it once it is there.
    setTimeout(() => noteRef.current?.focus(), 0);
  };

  return (
    <div className="pb-10">
      <BackLink to="/deals">Deals</BackLink>

      {deal.doNotContact && (
        <div className="px-6 pt-4">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            The contact is Do Not Contact: every send is blocked and automation is stopped. The deal
            stays open.
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 px-6 py-4 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        {/* Left: the deal, its stage/outcome and properties. */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Avatar name={deal.contactName} className="size-12 text-base" />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-lg font-semibold leading-tight">
                    <Link
                      to="/contacts/$contactId"
                      params={{ contactId: deal.contactId }}
                      className="hover:underline"
                    >
                      {deal.contactName}
                    </Link>
                  </h1>
                  <p className="truncate text-sm text-muted-foreground">
                    {deal.companyName ? (
                      <CompanyLink id={deal.companyId} name={deal.companyName} />
                    ) : (
                      "No company"
                    )}
                    {deal.serviceInterest && <> · {deal.serviceInterest}</>}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <StatusBadge value={deal.outcome} />
                <StatusBadge value={deal.stage} />
                <StatusBadge value={deal.automationMode} dot />
                {deal.amount !== null && (
                  <span className="num font-medium">{money(deal.amount)}</span>
                )}
                {deal.closedAt && (
                  <span className="text-muted-foreground">Closed {fmtDate(deal.closedAt)}</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Panel title="Stage and outcome">
            <div className="space-y-3 text-sm">
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
                  className={cn(NATIVE_SELECT, "h-8 w-full px-2 text-sm")}
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </Field>
              {open ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-success/40 text-success hover:bg-success/10"
                    onClick={() => setDialog({ kind: "outcome", action: "won" })}
                  >
                    Won
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setDialog({ kind: "lost" })}
                  >
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
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setDialog({ kind: "outcome", action: "reopen" })}
                >
                  Reopen
                </Button>
              )}
              {deal.lossReason && <InfoRow name="Loss reason" value={label(deal.lossReason)} />}
              {deal.lossNotes && <p className="text-xs text-muted-foreground">{deal.lossNotes}</p>}
              {deal.objectionType && <InfoRow name="Objection" value={label(deal.objectionType)} />}
            </div>
          </Panel>

          <Panel title="Deal properties">
            <div className="space-y-3 text-sm">
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
                  className={cn(NATIVE_SELECT, "h-8 w-full px-2 text-sm")}
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
                    className={cn(NATIVE_SELECT, "h-8 min-w-0 flex-1 px-2 text-sm")}
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
              <div className="space-y-2">
                <AmountField
                  // Starts again from the saved value after every save.
                  key={deal.amount ?? "none"}
                  amount={deal.amount}
                  disabled={patch.isPending}
                  onSave={(amount) =>
                    patch.mutate(
                      { amount },
                      { onSuccess: () => toast.success("Amount saved"), onError: toastError },
                    )
                  }
                />
                <InfoRow name="Response" value={label(deal.responseState)} />
                <InfoRow name="Lifecycle" value={label(deal.lifecycleStage)} />
                <InfoRow name="Last activity" value={relDay(deal.lastActivityAt)} />
                <InfoRow name="Created" value={fmtDateTime(deal.createdAt)} />
                {deal.closedAt && <InfoRow name="Closed" value={fmtDateTime(deal.closedAt)} />}
              </div>
            </div>
          </Panel>

          {deal.interestedLaterReason || deal.interestedLaterRestartAt ? (
            <Panel title="Interested - Later">
              <div className="space-y-2 text-sm">
                <InfoRow name="Reason" value={deal.interestedLaterReason} />
                <InfoRow
                  name="Restart"
                  value={deal.interestedLaterRestartAt && fmtDate(deal.interestedLaterRestartAt)}
                />
                <InfoRow name="Next action" value={deal.interestedLaterNextAction} />
                <InfoRow name="Decision owner" value={deal.interestedLaterDecisionOwner} />
              </div>
            </Panel>
          ) : null}
        </div>

        {/* Middle: quick actions and activity. */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="grid grid-cols-4 gap-1 p-2">
              <QuickAction icon={StickyNote} label="Note" onClick={writeNote} />
              <QuickAction
                icon={Phone}
                label="Call"
                onClick={() => setDialog({ kind: "call" })}
                disabledReason={contact ? undefined : "Loading the contact"}
              />
              <QuickAction
                icon={ListChecks}
                label="Task"
                onClick={() => setDialog({ kind: "task" })}
              />
              <QuickAction
                icon={CalendarDays}
                label="Meeting"
                onClick={() => setDialog({ kind: "meeting" })}
              />
            </CardContent>
          </Card>

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
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
              {open && <TabsTrigger value="followups">Follow-ups</TabsTrigger>}
            </TabsList>

            <TabsContent value="activity" className="mt-4 space-y-3">
              <Card>
                <CardContent className="space-y-2 p-3">
                  <Textarea
                    ref={noteRef}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Write a note on this deal…"
                    aria-label="New note"
                  />
                  <div className="flex justify-end">
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
                  </div>
                </CardContent>
              </Card>

              <div>
                <div className="flex items-center justify-between pb-1">
                  <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Upcoming tasks ({openTasks.length})
                  </h2>
                </div>
                <Section
                  query={{ ...detail.tasks, data: { data: openTasks } }}
                  empty="No open tasks. Add one so the deal has a next action."
                >
                  {(data) =>
                    data.data.map((task) => (
                      <div
                        key={task.id}
                        className="flex flex-wrap items-center gap-2 border-b py-2.5 last:border-0"
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
                  <details className="pt-2 text-sm">
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
              </div>

              <TimelineList query={detail.timeline} />
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
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

            {open && (
              <TabsContent value="followups" className="mt-4">
                <ScheduledFollowupTimeline
                  runs={dealRuns}
                  scheduledActions={dealActions}
                  doNotContact={deal.doNotContact}
                  onEnrollClick={() => enroll()}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* Right: associated records. */}
        <div className="space-y-4 lg:col-start-2 xl:col-start-auto">
          <Panel title="Contact">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2.5">
                <Avatar name={deal.contactName} />
                <div className="min-w-0">
                  <Link
                    to="/contacts/$contactId"
                    params={{ contactId: deal.contactId }}
                    className="block truncate font-medium hover:underline"
                  >
                    {deal.contactName}
                  </Link>
                  {contact?.jobTitle && (
                    <div className="truncate text-xs text-muted-foreground">{contact.jobTitle}</div>
                  )}
                </div>
              </div>
              <InfoRow name="Email" value={deal.email && <CopyValue value={deal.email} />} />
              <InfoRow name="Phone" value={deal.phone && <CopyValue value={deal.phone} />} />
              <InfoRow
                name="Status"
                value={<StatusBadge value={deal.doNotContact ? "do_not_contact" : "active"} />}
              />
            </div>
          </Panel>

          <Panel title="Company">
            {deal.companyId ? (
              <div className="space-y-1 text-sm">
                <CompanyLink id={deal.companyId} name={deal.companyName} />
                {company && (
                  <div className="text-xs text-muted-foreground">
                    {[company.domain, company.industry, company.city ?? company.country]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No company.</p>
            )}
          </Panel>

          <Panel
            title={`Meetings (${meetings.length})`}
            action={
              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "meeting" })}>
                Schedule
              </Button>
            }
          >
            {meetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings yet.</p>
            ) : (
              <div className="space-y-3">
                {meetings.map((meeting) => (
                  <div key={meeting.id} className="text-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium">{meeting.title}</span>
                      <StatusBadge value={meeting.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDateTime(meeting.at)}
                      {meeting.outcome && <> · {label(meeting.outcome)}</>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 pt-0.5 text-xs">
                      {(meeting.meetLink ?? meeting.url) && (
                        <a
                          href={meeting.meetLink ?? meeting.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          Join
                        </a>
                      )}
                      {meeting.status !== "completed" && (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => setDialog({ kind: "meeting", meeting })}
                        >
                          Reschedule
                        </button>
                      )}
                      {meeting.status !== "completed" && meeting.status !== "cancelled" && (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => setDialog({ kind: "meetingOutcome", meeting })}
                        >
                          Record outcome
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={`Proposals (${proposals.length})`}
            action={
              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "newProposal" })}>
                New
              </Button>
            }
          >
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No proposals yet.</p>
            ) : (
              <div className="space-y-3">
                {proposals.map((proposal) => {
                  const terminal = TERMINAL_PROPOSAL.includes(proposal.status);
                  return (
                    <div key={proposal.id} className="space-y-1 text-sm">
                      <div className="flex items-baseline gap-1.5">
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {proposal.title}
                        </span>
                        {proposal.amount !== undefined && (
                          <span className="num text-xs">{money(proposal.amount)}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          proposal.fileName ?? "No document",
                          proposal.emailSendStatus !== "not_applicable" &&
                            `Email: ${label(proposal.emailSendStatus)}`,
                          proposal.whatsappSendStatus !== "not_applicable" &&
                            `WhatsApp: ${label(proposal.whatsappSendStatus)}`,
                          proposal.lossReason && `Loss: ${label(proposal.lossReason)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
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
                        className={cn(NATIVE_SELECT, "h-7 w-full px-2 text-xs")}
                      >
                        {PROPOSAL_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {label(s)}
                          </option>
                        ))}
                      </select>
                      {!terminal && (
                        <div className="flex gap-3 text-xs">
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => setDialog({ kind: "upload", proposal })}
                          >
                            {proposal.fileName ? "Replace document" : "Upload document"}
                          </button>
                          {proposal.fileName && (
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => setDialog({ kind: "send", proposal })}
                            >
                              Send
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title={`Automation runs (${dealRuns.length})`}>
            {dealRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workflow runs for this deal.</p>
            ) : (
              <div className="space-y-2.5">
                {dealRuns.map((run) => (
                  <div key={run.id} className="text-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {workflowName(run.workflowId)} V{run.version}
                      </span>
                      <StatusBadge value={run.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Started {relDay(run.startedAt)}
                      {run.nextRunAt && <> · Next {relDay(run.nextRunAt)}</>}
                    </div>
                    {run.lastError && (
                      <div className="text-xs text-destructive">{run.lastError}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
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

/** Deal value in INR; empty clears it. Saved with the button or Enter. */
function AmountField({
  amount,
  disabled,
  onSave,
}: {
  amount: number | null;
  disabled: boolean;
  onSave: (amount: number | null) => void;
}) {
  const [text, setText] = useState(amount === null ? "" : String(amount));
  const value = text.trim() === "" ? null : Number(text);
  const valid = value === null || (Number.isFinite(value) && value >= 0);
  const changed = value !== amount;
  const save = () => valid && changed && onSave(value);
  return (
    <Field label="Amount (INR)">
      <div className="flex gap-2">
        <Input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          aria-label="Deal amount"
          placeholder="Not set"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="h-8"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !valid || !changed}
          onClick={save}
        >
          Save
        </Button>
      </div>
      {amount !== null && <p className="pt-1 text-xs text-muted-foreground">{money(amount)}</p>}
    </Field>
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
