import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarDays, FileText, ListChecks, Users } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common/status-badge";
import { isOverdue, isToday, relDay } from "@/lib/format";
import { useLeads, useMeetings, useProposals, useSession, useTasks, useTimeline } from "@/store";
import { CLOSED_STAGES } from "@/types";

export function DashboardPage() {
  const { leads } = useLeads();
  const { tasks } = useTasks();
  const { meetings } = useMeetings();
  const { proposals } = useProposals();
  const { timeline } = useTimeline();
  const { userName } = useSession();

  const activeLeads = leads.filter((l) => !CLOSED_STAGES.includes(l.stage) && !l.doNotContact);
  const dueToday = tasks.filter((t) => !t.done && isToday(t.dueAt));
  const meetingsToday = meetings.filter((m) => isToday(m.at) && m.status !== "Cancelled");
  const proposalFollowUps = proposals.filter((p) => p.status === "Sent" || p.status === "Pending");
  const overdue = tasks.filter((t) => !t.done && isOverdue(t.dueAt));
  const missingNext = activeLeads.filter((l) => !l.nextAction);

  const called = new Set(timeline.filter((e) => e.kind === "call").map((e) => e.leadId));
  const connected = new Set(
    timeline
      .filter((e) => e.kind === "call" && e.title.startsWith("Call Connected"))
      .map((e) => e.leadId),
  );
  const funnel = [
    { label: "Leads", value: leads.length },
    { label: "Called", value: called.size },
    { label: "Connected", value: connected.size },
    { label: "Meetings", value: new Set(meetings.map((m) => m.leadId)).size },
    { label: "Proposals", value: new Set(proposals.map((p) => p.leadId)).size },
    { label: "Won", value: leads.filter((l) => l.stage === "Won").length },
  ];
  const max = Math.max(...funnel.map((f) => f.value), 1);

  const cards = [
    { label: "Active leads", value: activeLeads.length, icon: Users, to: "/leads" as const },
    {
      label: "Tasks / calls due today",
      value: dueToday.length,
      icon: ListChecks,
      to: "/tasks" as const,
    },
    {
      label: "Meetings today",
      value: meetingsToday.length,
      icon: CalendarDays,
      to: "/meetings" as const,
    },
    {
      label: "Proposal follow-ups",
      value: proposalFollowUps.length,
      icon: FileText,
      to: "/proposals" as const,
    },
    { label: "Overdue actions", value: overdue.length, icon: AlertTriangle, to: "/tasks" as const },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Dashboard"
        description="Everything due today, plus anything that needs a decision."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/leads">Open leads</Link>
          </Button>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((c) => (
            <Link key={c.label} to={c.to}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
                    <c.icon className="size-4" />
                  </div>
                  <div>
                    <div className="num text-2xl font-semibold leading-none">{c.value}</div>
                    <div className="pt-1 text-xs text-muted-foreground">{c.label}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pipeline funnel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {funnel.map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-xs text-muted-foreground">{f.label}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded bg-primary/80"
                      style={{ width: `${Math.max((f.value / max) * 100, 4)}%` }}
                    />
                  </div>
                  <div className="num w-8 text-right text-sm font-medium">{f.value}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Needs attention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Attention
                tone="danger"
                label="Overdue actions"
                count={overdue.length}
                detail="Tasks past their due date"
                to="/tasks"
              />
              <Attention
                tone="warning"
                label="Leads without a next action"
                count={missingNext.length}
                detail="Every active lead must have one"
                to="/leads"
              />
              <Attention
                tone="warning"
                label="Proposals awaiting decision"
                count={proposals.filter((p) => p.status === "Pending").length}
                detail="Follow up before they go cold"
                to="/proposals"
              />
              <Attention
                tone="info"
                label="Automation failures"
                count={0}
                detail="Runs that need a retry"
                to="/automations"
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Today&apos;s queue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {["Lead", "Action", "Type", "Due", "Owner"].map((h) => (
                      <th key={h} className="px-4 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...overdue, ...dueToday].slice(0, 10).map((t, index) => {
                    const lead = leads.find((l) => l.id === t.leadId);
                    return (
                      <tr key={`${t.id}-${index}`} className="border-t hover:bg-accent/40">
                        <td className="px-4 py-2">
                          {lead && (
                            <Link
                              to="/leads/$leadId"
                              params={{ leadId: lead.id }}
                              className="hover:underline"
                            >
                              {lead.firstName} {lead.lastName} · {lead.company}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-2">{t.title}</td>
                        <td className="px-4 py-2">
                          <StatusBadge value={t.type} tone="neutral" />
                        </td>
                        <td
                          className={`px-4 py-2 text-xs ${isOverdue(t.dueAt) ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {relDay(t.dueAt)}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {userName(t.ownerId)}
                        </td>
                      </tr>
                    );
                  })}
                  {overdue.length + dueToday.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-sm text-muted-foreground"
                      >
                        Nothing due today.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Attention({
  label,
  count,
  detail,
  tone,
  to,
}: {
  label: string;
  count: number;
  detail: string;
  tone: "danger" | "warning" | "info";
  to: "/tasks" | "/leads" | "/proposals" | "/automations";
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:bg-accent/40"
    >
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      <StatusBadge
        value={String(count)}
        tone={
          count === 0
            ? "muted"
            : tone === "danger"
              ? "danger"
              : tone === "warning"
                ? "warning"
                : "info"
        }
      />
    </Link>
  );
}
