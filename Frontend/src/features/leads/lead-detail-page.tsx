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
import { LogCallDialog } from "@/features/leads/log-call-dialog";
import { addDays, NOW } from "@/lib/dates";
import { fmtDateTime, isOverdue, money, relDay } from "@/lib/format";
import {
  useAutomations,
  useLeads,
  useMeetings,
  useProposals,
  useSession,
  useTasks,
  useTimeline,
} from "@/store";
import { PIPELINE_STAGES, TASK_TYPES, type PipelineStage, type TaskType } from "@/types";

export function LeadDetailPage({ leadId }: { leadId: string }) {
  const { getLead, updateLead, setAutomation, markDnc, addNote } = useLeads();
  const { addTask, tasks, toggleTask } = useTasks();
  const { addTimeline, timeline } = useTimeline();
  const { userName, users, currentUser } = useSession();
  const { meetings } = useMeetings();
  const { proposals } = useProposals();
  const { workflows, runs } = useAutomations();

  const lead = getLead(leadId);
  const [callOpen, setCallOpen] = useState(false);
  const [dncOpen, setDncOpen] = useState(false);
  const [dncReason, setDncReason] = useState("");
  const [nextOpen, setNextOpen] = useState(false);
  const [note, setNote] = useState("");

  const activity = useMemo(
    () =>
      timeline
        .filter((e) => e.leadId === leadId)
        .slice()
        .sort((a, b) => (a.at < b.at ? 1 : -1)),
    [timeline, leadId],
  );

  if (!lead) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Lead not found.{" "}
        <Link to="/leads" className="underline">
          Back to leads
        </Link>
      </div>
    );
  }

  const leadMeetings = meetings.filter((m) => m.leadId === leadId);
  const leadProposals = proposals.filter((p) => p.leadId === leadId);
  const leadTasks = tasks.filter((t) => t.leadId === leadId && !t.done);
  const leadRuns = runs.filter((r) => r.leadId === leadId);

  const completeNextAction = () => {
    if (!lead.nextAction) return;
    addTimeline({
      leadId,
      at: NOW,
      kind: "task",
      title: "Next Action Completed",
      actor: currentUser.name,
      source: "Manual",
      detail: lead.nextAction.title,
    });
    updateLead(leadId, { nextAction: null });
    toast.success("Next action completed — set the following one");
    setNextOpen(true);
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={`${lead.firstName} ${lead.lastName}`}
        description={`${lead.jobTitle || "—"} · ${lead.company} · ${lead.industry}`}
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
              onClick={() => {
                addTimeline({
                  leadId,
                  at: NOW,
                  kind: "email",
                  title: "Email Sent",
                  actor: currentUser.name,
                  source: "Manual",
                  detail: "Manual email from lead record",
                });
                toast.success("Email logged");
              }}
            >
              <Mail className="mr-1 size-4" /> Email
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={lead.doNotContact}
              onClick={() => {
                addTimeline({
                  leadId,
                  at: NOW,
                  kind: "whatsapp",
                  title: "WhatsApp Sent",
                  actor: currentUser.name,
                  source: "Manual",
                  detail: "Manual WhatsApp message",
                });
                toast.success("WhatsApp message logged");
              }}
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
                      {lead.nextAction.type} · due{" "}
                      <span className={isOverdue(lead.nextAction.dueAt) ? "text-destructive" : ""}>
                        {relDay(lead.nextAction.dueAt)}
                      </span>{" "}
                      · {userName(lead.nextAction.ownerId)}
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
                  <Button size="sm" variant="outline" onClick={completeNextAction}>
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
                  <Row label="Industry" value={lead.industry} />
                  <Row label="Interest" value={lead.serviceInterest} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Pipeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <Label className="mb-1.5 block text-xs">Stage</Label>
                    <Select
                      value={lead.stage}
                      onValueChange={(v) => {
                        updateLead(leadId, { stage: v as PipelineStage });
                        addTimeline({
                          leadId,
                          at: NOW,
                          kind: "stage",
                          title: `Stage changed to ${v}`,
                          actor: currentUser.name,
                          source: "Manual",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PIPELINE_STAGES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs">Owner</Label>
                    <Select
                      value={lead.ownerId}
                      onValueChange={(v) => updateLead(leadId, { ownerId: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Row label="Source" value={lead.source} />
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
                  {leadTasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div>
                        <div className="text-sm">{t.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.type} · {relDay(t.dueAt)} · {t.origin}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => toggleTask(t.id)}>
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
                <CardContent className="space-y-0">
                  {activity.map((e) => (
                    <div key={e.id} className="flex gap-3 border-b py-3 last:border-0">
                      <div className="w-32 shrink-0 text-xs text-muted-foreground">
                        {relDay(e.at)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{e.title}</span>
                          <StatusBadge
                            value={e.source}
                            tone={e.source === "Automation" ? "primary" : "muted"}
                          />
                        </div>
                        {e.detail && (
                          <p className="pt-0.5 text-sm text-muted-foreground">{e.detail}</p>
                        )}
                        <div className="pt-0.5 text-xs text-muted-foreground">{e.actor}</div>
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
              {leadMeetings.map((m) => (
                <Card key={m.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div>
                      <div className="text-sm font-medium">{m.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(m.at)} · {m.durationMin} min · {userName(m.ownerId)}
                      </div>
                      {m.outcome && (
                        <div className="pt-1 text-xs text-muted-foreground">
                          Outcome: {m.outcome}
                        </div>
                      )}
                    </div>
                    <StatusBadge value={m.status} />
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
              {leadProposals.map((p) => (
                <Card key={p.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div>
                      <div className="text-sm font-medium">{p.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.fileName} · {p.amount ? money(p.amount) : "No value"} · updated{" "}
                        {relDay(p.updatedAt)}
                      </div>
                    </div>
                    <StatusBadge value={p.status} />
                  </CardContent>
                </Card>
              ))}
              {leadProposals.length === 0 && (
                <Card>
                  <CardContent className="flex items-center justify-between py-6">
                    <p className="text-sm text-muted-foreground">No proposals uploaded.</p>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/proposals">Upload proposal</Link>
                    </Button>
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
                    <StatusBadge value={lead.automation} dot />
                    <span className="text-xs text-muted-foreground">
                      Automation runs in n8n and is controlled from here.
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["Active", "Paused", "Manual", "Stopped"] as const).map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={lead.automation === m ? "default" : "outline"}
                        disabled={lead.doNotContact}
                        onClick={() => {
                          setAutomation(leadId, m, "Changed from lead record");
                          toast.success(`Automation set to ${m}`);
                        }}
                      >
                        {m}
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
                  {leadRuns.map((r) => {
                    const wf = workflows.find((w) => w.id === r.workflowId);
                    return (
                      <div key={r.id} className="rounded-md border px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">
                            {wf?.name ?? r.workflowId} · V{r.version}
                          </div>
                          <StatusBadge value={r.status} />
                        </div>
                        <div className="pt-0.5 text-xs text-muted-foreground">
                          Current step: {r.currentStep}
                          {r.nextRunAt ? ` · next ${relDay(r.nextRunAt)}` : ""}
                        </div>
                        {r.lastError && (
                          <div className="pt-0.5 text-xs text-destructive">{r.lastError}</div>
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
            </TabsContent>

            <TabsContent value="notes" className="mt-4 space-y-3">
              <Card>
                <CardContent className="space-y-2 py-4">
                  <Textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note…"
                  />
                  <Button
                    size="sm"
                    disabled={!note.trim()}
                    onClick={() => {
                      addNote(leadId, note.trim());
                      setNote("");
                      toast.success("Note added");
                    }}
                  >
                    Add note
                  </Button>
                </CardContent>
              </Card>
              {lead.notes
                .slice()
                .reverse()
                .map((n) => (
                  <Card key={n.id}>
                    <CardContent className="py-3">
                      <div className="text-sm">{n.body}</div>
                      <div className="pt-1 text-xs text-muted-foreground">
                        {n.author} · {relDay(n.at)}
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
            <CardContent className="space-y-2 text-sm">
              <Row label="Stage" value={lead.doNotContact ? "Do Not Contact" : lead.stage} badge />
              <Row label="Automation" value={lead.automation} badge />
              <Row label="Owner" value={userName(lead.ownerId)} />
              <Row label="Last activity" value={relDay(lead.lastActivity)} />
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
                  onClick={() => {
                    updateLead(leadId, { doNotContact: false, automation: "Manual" });
                    toast.success("Suppression removed");
                  }}
                >
                  Remove suppression
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">How this lead flows</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              <p>UI changes are stored in Supabase and picked up by n8n.</p>
              <p className="flex items-center gap-1.5">
                <Bot className="size-3.5" /> Workflow behaviour is edited in Automations, not in
                n8n.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <LogCallDialog leadId={leadId} open={callOpen} onOpenChange={setCallOpen} />

      <Dialog open={dncOpen} onOpenChange={setDncOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Do Not Contact</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-xs">Reason</Label>
            <Textarea rows={3} value={dncReason} onChange={(e) => setDncReason(e.target.value)} />
            <p className="pt-2 text-xs text-muted-foreground">
              This stops all automation and clears the next action.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDncOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!dncReason.trim()}
              onClick={() => {
                markDnc(leadId, dncReason.trim());
                setDncOpen(false);
                setDncReason("");
                toast.success("Lead suppressed");
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NextActionDialog
        open={nextOpen}
        onOpenChange={setNextOpen}
        defaultOwner={lead.ownerId}
        onSave={(next) => {
          updateLead(leadId, { nextAction: next });
          addTask({
            leadId,
            ownerId: next.ownerId,
            type: next.type,
            title: next.title,
            dueAt: next.dueAt,
            done: false,
            origin: "Manual",
          });
          toast.success("Next action set");
        }}
      />
    </div>
  );
}

function Row({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {badge ? <StatusBadge value={value} /> : <span className="truncate text-sm">{value}</span>}
    </div>
  );
}

function NextActionDialog({
  open,
  onOpenChange,
  defaultOwner,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultOwner: string;
  onSave: (n: { type: TaskType; title: string; dueAt: string; ownerId: string }) => void;
}) {
  const { users } = useSession();
  const [type, setType] = useState<TaskType>("Call");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(addDays(1).slice(0, 10));
  const [owner, setOwner] = useState(defaultOwner);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set next action</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call to confirm interest"
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Due date</Label>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Owner</Label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim()}
            onClick={() => {
              onSave({ type, title: title.trim(), dueAt: `${due}T10:00:00`, ownerId: owner });
              setTitle("");
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
