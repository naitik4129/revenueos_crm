import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarDays, FileText, ListChecks, Target } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { useDashboard } from "@/store";
import type { StageCount } from "@/types";

export function DashboardPage() {
  const { summary, isLoading, error } = useDashboard();
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
  const cards = [
    { label: "Tasks due today", value: summary.tasks.dueToday, icon: ListChecks, to: "/tasks" },
    { label: "Overdue tasks", value: summary.tasks.overdue, icon: AlertTriangle, to: "/tasks" },
    { label: "Meetings today", value: summary.meetingsToday, icon: CalendarDays, to: "/meetings" },
    {
      label: "Proposals awaiting decision",
      value: summary.proposalsAwaitingDecision,
      icon: FileText,
      to: "/proposals",
    },
    {
      label: "Open deals with no next action",
      value: summary.openDealsMissingNextAction,
      icon: Target,
      to: "/deals",
    },
  ] as const;
  const openStages = summary.openDealsByStage.filter((item) => item.count > 0);
  const week = summary.activityThisWeek;

  return (
    <div className="pb-10">
      <PageHeader
        title="Dashboard"
        description="This workspace today, this week and this month (India time)."
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
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Contacts by lifecycle stage</CardTitle>
            </CardHeader>
            <CardContent>
              <Bars items={summary.lifecycleFunnel} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Open deals by stage</CardTitle>
            </CardHeader>
            <CardContent>
              {openStages.length > 0 ? (
                <Bars items={openStages} />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No open deals.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Stats
                heading="This week"
                items={[
                  ["AI calls", week.aiCalls],
                  ["Human calls", week.humanCalls],
                  ["Emails sent", week.emailsSent],
                  ["Email replies", week.emailsReplied],
                ]}
              />
              <Stats
                heading="This month"
                items={[
                  ["Deals won", summary.dealsThisMonth.won],
                  ["Deals lost", summary.dealsThisMonth.lost],
                ]}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">My queue today</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {["Contact", "Action", "Type", "Due"].map((heading) => (
                      <th key={heading} className="px-4 py-2 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.todaysQueue.map((task) => (
                    <tr key={task.id} className="border-t">
                      <td className="px-4 py-2">{task.contactName ?? "-"}</td>
                      <td className="px-4 py-2">{task.title}</td>
                      <td className="px-4 py-2">
                        <StatusBadge value={task.type} tone="neutral" />
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {relDay(task.dueAt)}
                      </td>
                    </tr>
                  ))}
                  {summary.todaysQueue.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
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

function Bars({ items }: { items: StageCount<string>[] }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.stage} className="flex items-center gap-3">
          <div className="w-32 shrink-0 truncate text-xs text-muted-foreground">
            {label(item.stage)}
          </div>
          <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-primary/80"
              style={{ width: `${item.count === 0 ? 0 : Math.max((item.count / max) * 100, 4)}%` }}
            />
          </div>
          <div className="num w-8 text-right text-sm font-medium">{item.count}</div>
        </div>
      ))}
    </div>
  );
}

function Stats({ heading, items }: { heading: string; items: [string, number][] }) {
  return (
    <div>
      <div className="pb-1.5 text-xs font-medium text-muted-foreground">{heading}</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(([name, value]) => (
          <div key={name} className="rounded-md border px-3 py-2">
            <div className="num text-lg font-semibold leading-none">{value}</div>
            <div className="pt-1 text-xs text-muted-foreground">{name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
