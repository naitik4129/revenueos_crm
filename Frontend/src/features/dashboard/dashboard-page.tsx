import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarDays, FileText, ListChecks, Users } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { isOverdue, relDay } from "@/lib/format";
import { useDashboard, useLeads, useSession } from "@/store";

export function DashboardPage() {
  const { summary, isLoading, error } = useDashboard();
  const { leads } = useLeads();
  const { userName } = useSession();
  if (isLoading)
    return (
      <div className="p-6">
        <LoadingBlock label="Loading dashboard…" />
      </div>
    );
  if (error || !summary)
    return (
      <div className="p-6">
        <ErrorBlock error={error ?? new Error("Dashboard data is unavailable.")} />
      </div>
    );
  const max = Math.max(...summary.pipelineFunnel.map((item) => item.value), 1);
  const cards = [
    { label: "Active leads", value: summary.activeLeads, icon: Users, to: "/leads" as const },
    {
      label: "Tasks / calls due today",
      value: summary.tasksDueToday,
      icon: ListChecks,
      to: "/tasks" as const,
    },
    {
      label: "Meetings today",
      value: summary.meetingsToday,
      icon: CalendarDays,
      to: "/meetings" as const,
    },
    {
      label: "Proposal follow-ups",
      value: summary.proposalFollowUps,
      icon: FileText,
      to: "/proposals" as const,
    },
    {
      label: "Overdue actions",
      value: summary.overdueActions,
      icon: AlertTriangle,
      to: "/tasks" as const,
    },
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
          {cards.map((card) => (
            <Link key={card.label} to={card.to}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
                    <card.icon className="size-4" />
                  </div>
                  <div>
                    <div className="num text-2xl font-semibold leading-none">{card.value}</div>
                    <div className="pt-1 text-xs text-muted-foreground">{card.label}</div>
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
              {summary.pipelineFunnel.map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-xs text-muted-foreground">{item.label}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded bg-primary/80"
                      style={{ width: `${Math.max((item.value / max) * 100, 4)}%` }}
                    />
                  </div>
                  <div className="num w-8 text-right text-sm font-medium">{item.value}</div>
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
                label="Overdue actions"
                count={summary.overdueActions}
                detail="Tasks past their due date"
                to="/tasks"
                tone="danger"
              />
              <Attention
                label="Leads without a next action"
                count={summary.leadsWithNoNextAction}
                detail="Every active lead must have one"
                to="/leads"
                tone="warning"
              />
              <Attention
                label="Proposal follow-ups"
                count={summary.proposalFollowUps}
                detail="Follow up before they go cold"
                to="/proposals"
                tone="warning"
              />
              <Attention
                label="Automation failures"
                count={summary.automationFailures}
                detail="Runs that need a retry"
                to="/automations"
                tone="info"
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
                    {["Lead", "Action", "Type", "Due", "Owner"].map((heading) => (
                      <th key={heading} className="px-4 py-2 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.todaysQueue.map((task) => {
                    const lead = leads.find((item) => item.id === task.leadId);
                    return (
                      <tr key={task.id} className="border-t hover:bg-accent/40">
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
                        <td className="px-4 py-2">{task.title}</td>
                        <td className="px-4 py-2">
                          <StatusBadge value={task.type} tone="neutral" />
                        </td>
                        <td
                          className={`px-4 py-2 text-xs ${isOverdue(task.dueAt) ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {relDay(task.dueAt)}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {userName(task.ownerId)}
                        </td>
                      </tr>
                    );
                  })}
                  {summary.todaysQueue.length === 0 && (
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
      <StatusBadge value={String(count)} tone={count === 0 ? "muted" : tone} />
    </Link>
  );
}
