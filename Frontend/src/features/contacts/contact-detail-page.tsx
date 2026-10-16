import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, Phone } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { backend } from "@/lib/backend-client";
import { fmtDateTime, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { messageFromError, useContactDetail, useContactMutation, useSession } from "@/store";
import { LIFECYCLE_STAGES, type ContactCall, type EmailActivity } from "@/types";
import { ContactFormDialog } from "./contact-form-dialog";
import { ContactabilityDialog, DncDialog, LifecycleDialog, MergeDialog } from "./contact-dialogs";
import { LogCallDialog } from "./log-call-dialog";

type DialogName = "edit" | "call" | "dnc" | "lifecycle" | "channel" | "merge";

export function ContactDetailPage({ contactId }: { contactId: string }) {
  const detail = useContactDetail(contactId);
  const { currentUser } = useSession();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [note, setNote] = useState("");
  const addNote = useContactMutation((body: string) => backend.contacts.addNote(contactId, body));

  const contact = detail.contact.data;
  if (detail.contact.isLoading)
    return (
      <div className="p-6">
        <LoadingBlock label="Loading contact…" />
      </div>
    );
  if (!contact)
    return (
      <div className="p-6">
        <ErrorBlock error={detail.contact.error ?? new Error("Contact not found.")} />
      </div>
    );

  const name = `${contact.firstName} ${contact.lastName}`.trim();
  const merged = contact.status === "merged";
  const deals = detail.deals.data?.data ?? [];
  const close = (open: boolean) => !open && setDialog(null);
  const dialogProps = (name: DialogName) => ({
    contact,
    open: dialog === name,
    onOpenChange: close,
  });

  return (
    <div className="pb-10">
      <PageHeader
        title={name}
        heading={
          <div>
            <Link to="/contacts" className="text-xs text-muted-foreground hover:underline">
              Contacts
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[contact.jobTitle, contact.companyName].filter(Boolean).join(" · ") || "No company"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusBadge value={contact.lifecycleStage} tone="primary" />
              <StatusBadge value={contact.status} />
              <StatusBadge value={contact.source} tone="neutral" />
            </div>
          </div>
        }
        actions={
          !merged && (
            <>
              <Button size="sm" onClick={() => setDialog("call")}>
                <Phone className="size-4" /> Log call
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
                Edit
              </Button>
              <Button
                size="sm"
                variant={contact.doNotContact ? "outline" : "destructive"}
                onClick={() => setDialog("dnc")}
              >
                {contact.doNotContact ? "Lift DNC" : "Mark DNC"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog("merge")}>
                Merge
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
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

          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">Timeline</TabsTrigger>
              <TabsTrigger value="calls">Calls ({detail.calls.data?.data.length ?? 0})</TabsTrigger>
              <TabsTrigger value="emails">
                Emails ({detail.emails.data?.data.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="deals">Deals ({deals.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="activity" className="mt-4">
              <Section query={detail.timeline} empty="No activity yet.">
                {(data) =>
                  data.data.map((event) => (
                    <div key={event.id} className="flex gap-3 border-b py-3 last:border-0">
                      <div className="w-36 shrink-0 text-xs text-muted-foreground">
                        {relDay(event.at)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{event.title}</span>
                          <StatusBadge
                            value={event.source}
                            tone={event.source === "user" ? "muted" : "primary"}
                          />
                        </div>
                        {event.detail && (
                          <p className="whitespace-pre-wrap pt-0.5 text-sm text-muted-foreground">
                            {event.detail}
                          </p>
                        )}
                        <div className="pt-0.5 text-xs text-muted-foreground">{event.actor}</div>
                      </div>
                    </div>
                  ))
                }
              </Section>
            </TabsContent>

            <TabsContent value="calls" className="mt-4">
              <Section query={detail.calls} empty="No calls yet.">
                {(data) => data.data.map((call) => <CallRow key={call.id} call={call} />)}
              </Section>
            </TabsContent>

            <TabsContent value="emails" className="mt-4">
              <Section query={detail.emails} empty="No campaign emails yet.">
                {(data) => data.data.map((email) => <EmailRow key={email.id} email={email} />)}
              </Section>
            </TabsContent>

            <TabsContent value="notes" className="mt-4 space-y-3">
              {!merged && (
                <Card>
                  <CardContent className="space-y-2 py-4">
                    <Textarea
                      rows={3}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add a note…"
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
                          onError: (error) => toast.error(messageFromError(error)),
                        })
                      }
                    >
                      Add note
                    </Button>
                  </CardContent>
                </Card>
              )}
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

            <TabsContent value="deals" className="mt-4">
              <Section
                query={detail.deals}
                empty="No deals. A deal opens on a qualified handover, a call that moves the pipeline, or by hand."
              >
                {(data) =>
                  data.data.map((deal) => (
                    <div
                      key={deal.id}
                      className="flex flex-wrap items-center gap-2 border-b py-3 last:border-0"
                    >
                      <StatusBadge value={deal.outcome} />
                      <StatusBadge value={deal.stage} />
                      <span className="text-sm">{deal.serviceInterest ?? "Deal"}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {deal.ownerName ?? "Unassigned"} · {relDay(deal.lastActivityAt)}
                      </span>
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
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row name="Email" value={contact.email} />
              <Row name="Phone" value={contact.phone} />
              <Row
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
              <Row name="Company" value={contact.companyName} />
              <Row
                name="Location"
                value={[contact.location, contact.country].filter(Boolean).join(", ")}
              />
              <Row name="Owner" value={contact.ownerName ?? "Unassigned"} />
              <Row name="Added" value={fmtDateTime(contact.createdAt)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Lifecycle stage</CardTitle>
              {!merged && (
                <Button size="sm" variant="ghost" onClick={() => setDialog("lifecycle")}>
                  Change
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <ol className="flex gap-1" aria-label="Lifecycle stage">
                {LIFECYCLE_STAGES.map((stage, i) => {
                  const reached = i <= LIFECYCLE_STAGES.indexOf(contact.lifecycleStage);
                  return (
                    <li
                      key={stage}
                      aria-current={stage === contact.lifecycleStage ? "step" : undefined}
                      className={`flex-1 rounded px-1 py-1 text-center text-[11px] ${
                        reached
                          ? "bg-primary/15 font-medium text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {label(stage)}
                    </li>
                  );
                })}
              </ol>
              <p className="pt-2 text-xs text-muted-foreground">
                Since {relDay(contact.lifecycleChangedAt)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Contactability</CardTitle>
              {!merged && (
                <Button size="sm" variant="ghost" onClick={() => setDialog("channel")}>
                  Update
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(detail.channels.data?.data ?? []).map((item) => (
                <div key={item.channel} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{label(item.channel)}</span>
                  <StatusBadge value={item.status} />
                </div>
              ))}
              {detail.channels.data?.data.length === 0 && (
                <p className="text-xs text-muted-foreground">No channel status recorded.</p>
              )}
            </CardContent>
          </Card>
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
    </div>
  );
}

function Section<T extends { data: unknown[] }>({
  query,
  empty,
  children,
}: {
  query: { data?: T | undefined; isLoading: boolean; error: unknown };
  empty: string;
  children: (data: T) => ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-2">
        {query.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : query.error ? (
          <p className="py-6 text-center text-sm text-destructive">
            {messageFromError(query.error)}
          </p>
        ) : query.data && query.data.data.length > 0 ? (
          children(query.data)
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
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

function Row({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{name}</span>
      <span className="min-w-0 truncate text-right">{value || "-"}</span>
    </div>
  );
}
