import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, CalendarDays, ChevronDown, ListChecks, Mail, Phone, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { InfoRow, Section, TimelineList } from "@/components/common/detail-parts";
import {
  Avatar,
  BackLink,
  CopyValue,
  MenuItem,
  Panel,
  QuickAction,
} from "@/components/common/record-parts";
import { backend } from "@/lib/backend-client";
import { fmtDateTime, isOverdue, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { messageFromError, useContactDetail, useCrmMutation, useSession } from "@/store";
import { LIFECYCLE_STAGES, type ContactCall, type EmailActivity } from "@/types";
import { CompanyLink } from "@/features/companies/company-link";
import { TaskDialog } from "@/features/deals/deal-dialogs";
import { ScheduleMeetingDialog } from "@/features/meetings/schedule-meeting-dialog";
import { ContactFormDialog } from "./contact-form-dialog";
import { ContactabilityDialog, DncDialog, LifecycleDialog, MergeDialog } from "./contact-dialogs";
import { LogCallDialog } from "./log-call-dialog";

type DialogName = "edit" | "call" | "dnc" | "lifecycle" | "channel" | "merge" | "task" | "meeting";

export function ContactDetailPage({ contactId }: { contactId: string }) {
  const detail = useContactDetail(contactId);
  const { currentUser } = useSession();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [tab, setTab] = useState("activity");
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const addNote = useCrmMutation((body: string) => backend.contacts.addNote(contactId, body));
  const saveMeeting = useCrmMutation((value: Parameters<typeof backend.meetings.create>[0]) =>
    backend.meetings.create(value),
  );

  const contact = detail.contact.data;
  if (detail.contact.isLoading)
    return (
      <div className="px-6 py-4">
        <LoadingBlock label="Loading contact…" />
      </div>
    );
  if (!contact)
    return (
      <div className="px-6 py-4">
        <ErrorBlock error={detail.contact.error ?? new Error("Contact not found.")} />
      </div>
    );

  const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.email || "(no name)";
  const merged = contact.status === "merged";
  const deals = detail.deals.data?.data ?? [];
  const openDeal = deals.find((d) => d.id === contact.openDealId);
  const company = detail.company.data;
  const upcoming = (detail.meetings.data?.data ?? [])
    .filter((m) => !isOverdue(m.at) && m.status !== "cancelled")
    .sort((a, b) => a.at.localeCompare(b.at));
  const close = (open: boolean) => !open && setDialog(null);
  const dialogProps = (name: DialogName) => ({
    contact,
    open: dialog === name,
    onOpenChange: close,
  });

  const writeNote = () => {
    setTab("activity");
    // The note box mounts with the Activity tab; focus it once it is there.
    setTimeout(() => noteRef.current?.focus(), 0);
  };
  const emailBlocked = !contact.email
    ? "No email address"
    : contact.doNotContact
      ? "Do Not Contact"
      : undefined;

  return (
    <div className="pb-10">
      <BackLink to="/contacts">Contacts</BackLink>

      {(merged || contact.doNotContact) && (
        <div className="space-y-2 px-6 pt-4">
          {merged && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              This contact was merged.{" "}
              {contact.mergedIntoContactId && (
                <Link
                  to="/contacts/$contactId"
                  params={{ contactId: contact.mergedIntoContactId }}
                  className="font-medium underline"
                >
                  Open the contact it was merged into
                </Link>
              )}
            </div>
          )}
          {contact.doNotContact && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Do Not Contact{contact.dncReason ? `: ${contact.dncReason}` : ""}
              {contact.dncBy ? ` (by ${contact.dncBy}, ${relDay(contact.dncAt)})` : ""}. Every send
              is blocked and automation is stopped.
            </div>
          )}
        </div>
      )}

      <div className="grid items-start gap-4 px-6 py-4 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        {/* Left: who this is, quick actions, key properties. */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Avatar name={name} className="size-12 text-base" />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-lg font-semibold leading-tight">{name}</h1>
                  <p className="truncate text-sm text-muted-foreground">
                    {contact.jobTitle}
                    {contact.jobTitle && contact.companyName && " · "}
                    <CompanyLink id={contact.companyId} name={contact.companyName} />
                  </p>
                  {contact.email && (
                    <p className="truncate text-xs text-muted-foreground">{contact.email}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <StatusBadge value={contact.lifecycleStage} tone="neutral" />
                <StatusBadge value={contact.status} />
              </div>

              {!merged && (
                <>
                  <div className="mt-4 grid grid-cols-5 gap-1">
                    <QuickAction icon={StickyNote} label="Note" onClick={writeNote} />
                    <QuickAction
                      icon={Mail}
                      label="Email"
                      href={emailBlocked ? undefined : `mailto:${contact.email}`}
                      disabledReason={emailBlocked}
                    />
                    <QuickAction icon={Phone} label="Call" onClick={() => setDialog("call")} />
                    <QuickAction icon={ListChecks} label="Task" onClick={() => setDialog("task")} />
                    <QuickAction
                      icon={CalendarDays}
                      label="Meeting"
                      onClick={() => setDialog("meeting")}
                      disabledReason={openDeal ? undefined : "Needs an open deal"}
                    />
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="mt-3 w-full gap-1">
                        Actions <ChevronDown className="size-3.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56 p-1">
                      <MenuItem onClick={() => setDialog("edit")}>Edit contact</MenuItem>
                      <MenuItem onClick={() => setDialog("merge")}>
                        Merge with another contact
                      </MenuItem>
                      <MenuItem danger={!contact.doNotContact} onClick={() => setDialog("dnc")}>
                        {contact.doNotContact ? "Lift Do Not Contact" : "Mark Do Not Contact"}
                      </MenuItem>
                    </PopoverContent>
                  </Popover>
                </>
              )}
            </CardContent>
          </Card>

          <Panel title="About this contact">
            <div className="space-y-2 text-sm">
              <InfoRow name="Email" value={contact.email && <CopyValue value={contact.email} />} />
              <InfoRow name="Phone" value={contact.phone && <CopyValue value={contact.phone} />} />
              <InfoRow
                name="LinkedIn"
                value={
                  contact.linkedinUrl && (
                    <a
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Profile
                    </a>
                  )
                }
              />
              <InfoRow name="Owner" value={contact.ownerName ?? "Unassigned"} />
              <InfoRow
                name="Location"
                value={[contact.location, contact.country].filter(Boolean).join(", ")}
              />
              <InfoRow name="Source" value={label(contact.source)} />
              <InfoRow name="Last activity" value={relDay(contact.lastActivityAt)} />
              <InfoRow name="Created" value={fmtDateTime(contact.createdAt)} />
            </div>
          </Panel>

          <Panel
            title="Lifecycle stage"
            action={
              !merged && (
                <Button size="sm" variant="ghost" onClick={() => setDialog("lifecycle")}>
                  Change
                </Button>
              )
            }
          >
            <ol className="flex gap-1" aria-label="Lifecycle stage">
              {LIFECYCLE_STAGES.map((stage, i) => {
                const reached = i <= LIFECYCLE_STAGES.indexOf(contact.lifecycleStage);
                return (
                  <li
                    key={stage}
                    title={label(stage)}
                    aria-current={stage === contact.lifecycleStage ? "step" : undefined}
                    className={cn("h-1.5 flex-1 rounded-full", reached ? "bg-primary" : "bg-muted")}
                  >
                    <span className="sr-only">{label(stage)}</span>
                  </li>
                );
              })}
            </ol>
            <p className="pt-2 text-xs text-muted-foreground">
              {label(contact.lifecycleStage)} since {relDay(contact.lifecycleChangedAt)}
            </p>
          </Panel>

          <Panel
            title="Contactability"
            action={
              !merged && (
                <Button size="sm" variant="ghost" onClick={() => setDialog("channel")}>
                  Update
                </Button>
              )
            }
          >
            <div className="space-y-2 text-sm">
              {(detail.channels.data?.data ?? []).map((item) => (
                <div key={item.channel} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{label(item.channel)}</span>
                  <StatusBadge value={item.status} />
                </div>
              ))}
              {detail.channels.data?.data.length === 0 && (
                <p className="text-xs text-muted-foreground">No channel status recorded.</p>
              )}
            </div>
          </Panel>
        </div>

        {/* Middle: activity. */}
        <div className="min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="emails">
                Emails ({detail.emails.data?.data.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="calls">Calls ({detail.calls.data?.data.length ?? 0})</TabsTrigger>
            </TabsList>

            <TabsContent value="activity" className="mt-4 space-y-3">
              {!merged && (
                <Card>
                  <CardContent className="space-y-2 p-3">
                    <Textarea
                      ref={noteRef}
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Write a note…"
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
                            onError: (error) => toast.error(messageFromError(error)),
                          })
                        }
                      >
                        Add note
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
              <TimelineList query={detail.timeline} />
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Section query={detail.notes} empty="No notes yet.">
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

            <TabsContent value="emails" className="mt-4">
              <Section query={detail.emails} empty="No campaign emails yet.">
                {(data) => data.data.map((email) => <EmailRow key={email.id} email={email} />)}
              </Section>
            </TabsContent>

            <TabsContent value="calls" className="mt-4">
              <Section query={detail.calls} empty="No calls yet.">
                {(data) => data.data.map((call) => <CallRow key={call.id} call={call} />)}
              </Section>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: associated records. */}
        <div className="space-y-4 lg:col-start-2 xl:col-start-auto">
          <Panel title="Company">
            {contact.companyId ? (
              <div className="space-y-1 text-sm">
                <CompanyLink id={contact.companyId} name={contact.companyName} />
                {company && (
                  <div className="text-xs text-muted-foreground">
                    {[company.domain, company.industry, company.city ?? company.country]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No company.{" "}
                {!merged && (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setDialog("edit")}
                  >
                    Add one
                  </button>
                )}
              </p>
            )}
          </Panel>

          <Panel title={`Deals (${deals.length})`}>
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deals. A deal opens on a qualified handover, a call that moves the pipeline, or
                by hand.
              </p>
            ) : (
              <div className="space-y-2.5">
                {deals.map((deal) => (
                  <div key={deal.id} className="text-sm">
                    <Link
                      to="/deals/$dealId"
                      params={{ dealId: deal.id }}
                      className="font-medium hover:underline"
                    >
                      {deal.serviceInterest ?? "Deal"}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={deal.stage} />
                      {deal.outcome !== "open" && <StatusBadge value={deal.outcome} />}
                    </div>
                    <div className="pt-0.5 text-xs text-muted-foreground">
                      {deal.ownerName ?? "Unassigned"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Open tasks"
            action={
              !merged && (
                <Button size="sm" variant="ghost" onClick={() => setDialog("task")}>
                  Add
                </Button>
              )
            }
          >
            {(detail.tasks.data?.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No open tasks.</p>
            ) : (
              <div className="space-y-2">
                {(detail.tasks.data?.data ?? []).map((task) => (
                  <div key={task.id} className="text-sm">
                    <div className="font-medium">{task.title}</div>
                    <div
                      className={cn(
                        "text-xs",
                        isOverdue(task.dueAt) ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {label(task.type)} · due {relDay(task.dueAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Upcoming meetings">
            {!openDeal ? (
              <p className="text-sm text-muted-foreground">
                Meetings belong to a deal; this contact has no open deal.
              </p>
            ) : upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming meetings.</p>
            ) : (
              <div className="space-y-2">
                {upcoming.map((m) => (
                  <div key={m.id} className="text-sm">
                    <div className="font-medium">{m.title}</div>
                    <div className="text-xs text-muted-foreground">{relDay(m.at)}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {dialog === "edit" && <ContactFormDialog {...dialogProps("edit")} />}
      {dialog === "call" && (
        <LogCallDialog {...dialogProps("call")} dealIds={deals.map((d) => d.id)} />
      )}
      {dialog === "dnc" && <DncDialog {...dialogProps("dnc")} />}
      {dialog === "lifecycle" && (
        <LifecycleDialog {...dialogProps("lifecycle")} isAdmin={currentUser?.role === "Admin"} />
      )}
      {dialog === "channel" && <ContactabilityDialog {...dialogProps("channel")} />}
      {dialog === "merge" && <MergeDialog {...dialogProps("merge")} />}
      {dialog === "task" && (
        <TaskDialog deal={openDeal} contactId={contact.id} onOpenChange={close} />
      )}
      {dialog === "meeting" && openDeal && (
        <ScheduleMeetingDialog
          dealId={openDeal.id}
          open
          meeting={null}
          isSaving={saveMeeting.isPending}
          onOpenChange={close}
          onSave={(value) =>
            saveMeeting.mutate(value, {
              onSuccess: () => {
                toast.success("Meeting scheduled");
                setDialog(null);
              },
              onError: (error) => toast.error(messageFromError(error)),
            })
          }
        />
      )}
    </div>
  );
}

function duration(seconds?: number) {
  if (seconds === undefined) return null;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function CallRow({ call }: { call: ContactCall }) {
  const ai = call.source === "ai";
  const outcome = ai
    ? (call.aiOutcome ?? (call.connected ? "Connected" : "Not connected"))
    : call.connected
      ? label(call.connectedOutcome)
      : `Not connected - ${label(call.notConnectedReason)}`;
  return (
    <div className="border-b py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        {ai ? (
          <Bot className="size-4 text-primary" aria-label="AI call" />
        ) : (
          <Phone className="size-4 text-muted-foreground" aria-label="Human call" />
        )}
        <span className="text-sm font-medium">{ai ? "AI call" : "Call"}</span>
        <StatusBadge value={outcome} tone={call.connected ? "success" : "muted"} />
        {duration(call.durationSeconds) && (
          <span className="text-xs text-muted-foreground">{duration(call.durationSeconds)}</span>
        )}
        {call.sentiment && (
          <span className="text-xs text-muted-foreground">· {call.sentiment}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtDateTime(call.at)}
          {call.salespersonName ? ` · ${call.salespersonName}` : ""}
        </span>
      </div>
      {call.summary && <p className="pt-1 text-sm">{call.summary}</p>}
      {call.notes && (
        <p className="whitespace-pre-wrap pt-1 text-sm text-muted-foreground">{call.notes}</p>
      )}
      {call.recordingUrl && (
        <a
          href={call.recordingUrl}
          target="_blank"
          rel="noreferrer"
          className="pt-1 text-xs text-primary hover:underline"
        >
          Recording
        </a>
      )}
      {call.transcript && (
        <details className="pt-1">
          <summary className="cursor-pointer text-xs text-primary">Transcript</summary>
          <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 text-xs">
            {call.transcript}
          </p>
        </details>
      )}
    </div>
  );
}

function EmailRow({ email }: { email: EmailActivity }) {
  return (
    <div className="border-b py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          value={email.status}
          tone={
            email.status === "replied"
              ? "success"
              : email.status === "bounced" || email.status === "unsubscribed"
                ? "danger"
                : "neutral"
          }
        />
        <span className="text-sm font-medium">{email.subject ?? "(no subject)"}</span>
        <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(email.sentAt)}</span>
      </div>
      <div className="pt-0.5 text-xs text-muted-foreground">
        {[
          email.campaignName ?? email.campaignRef,
          email.step !== undefined ? `step ${email.step}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {email.replyText && (
        <p className="mt-1 whitespace-pre-wrap rounded bg-muted/60 p-2 text-sm">
          <span className="block pb-1 text-xs text-muted-foreground">
            Reply, {fmtDateTime(email.repliedAt)}
          </span>
          {email.replyText}
        </p>
      )}
    </div>
  );
}
