import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileText,
  ListChecks,
  Target,
  Handshake,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Panel, StatCard } from "@/components/common/record-parts";
import { ListEmptyState } from "@/components/common/list-controls";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { backend } from "@/lib/backend-client";
import { fmtTime, percent } from "@/lib/format";
import { label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { messageFromError, useCrmMutation, useDashboard, useSession } from "@/store";
import { useWorkspace } from "@/store/workspace-context";
import type { DashboardSummary, StageCount } from "@/types";

export function DashboardPage() {
  const { summary, isLoading, error } = useDashboard();
  const { currentWorkspace } = useWorkspace();
  const { currentUser } = useSession();
  if (isLoading)
    return (
      <div className="px-6 py-4">
        <LoadingBlock label="Loading dashboard…" />
      </div>
    );
  if (error || !summary)
    return (
      <div className="px-6 py-4">
        <ErrorBlock error={error ?? new Error("Dashboard data is unavailable.")} />
      </div>
    );

  const week = summary.activityThisWeek;
  const month = summary.dealsThisMonth;
  const decided = month.won + month.lost;
  const lifecycleTotal = summary.lifecycleFunnel.reduce((n, s) => n + s.count, 0);
  const openStages = summary.openDealsByStage.filter((s) => s.count > 0);
  const openTotal = openStages.reduce((n, s) => n + s.count, 0);

  return (
    <div className="pb-10">
      <PageHeader
        title={currentUser?.name ? `Hello, ${currentUser.name.split(" ")[0]}` : "Dashboard"}
        description={`Workspace totals for ${currentWorkspace?.name ?? "this workspace"} · today, this week and this month (India time).`}
      />
      <div className="space-y-4 px-6 py-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <Link to="/tasks" search={{ view: "today" }} className={CARD_LINK}>
            <StatCard
              linked
              icon={ListChecks}
              value={summary.tasks.dueToday}
              label="Tasks due today"
            />
          </Link>
          <Link to="/tasks" search={{ view: "overdue" }} className={CARD_LINK}>
            <StatCard
              linked
              icon={AlertTriangle}
              value={summary.tasks.overdue}
              label="Overdue tasks"
              alert={summary.tasks.overdue > 0}
            />
          </Link>
          <Link to="/meetings" search={{ view: "today" }} className={CARD_LINK}>
            <StatCard
              linked
              icon={CalendarDays}
              value={summary.meetingsToday}
              label="Meetings today"
            />
          </Link>
          <Link to="/proposals" search={{ view: "sent" }} className={CARD_LINK}>
            <StatCard
              linked
              icon={FileText}
              value={summary.proposalsAwaitingDecision}
              label="Proposals awaiting decision"
            />
          </Link>
          <Link to="/deals" search={{ view: "noNext" }} className={CARD_LINK}>
            <StatCard
              linked
              icon={Target}
              value={summary.openDealsMissingNextAction}
              label="Open deals with no next action"
              alert={summary.openDealsMissingNextAction > 0}
            />
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title={`Contacts by lifecycle stage (${lifecycleTotal.toLocaleString()})`}>
            {lifecycleTotal === 0 ? (
              <Empty text="No contacts yet." to="/contacts" cta="Go to contacts" />
            ) : (
              <Bars
                items={summary.lifecycleFunnel}
                total={lifecycleTotal}
                link={(stage, body) => (
                  <Link to="/contacts" search={{ view: stage }}>
                    {body}
                  </Link>
                )}
              />
            )}
          </Panel>

          <Panel title={`Open deals by stage (${openTotal.toLocaleString()})`}>
            {openTotal === 0 ? (
              <Empty text="No open deals." to="/deals" cta="Go to deals" />
            ) : (
              <Bars
                items={openStages}
                total={openTotal}
                link={(_stage, body) => <Link to="/deals">{body}</Link>}
              />
            )}
          </Panel>

          <Panel title="Activity">
            <div className="space-y-4">
              <Stats
                heading="This week"
                items={[
                  ["AI calls", week.aiCalls],
                  ["Human calls", week.humanCalls],
                  ["Emails sent", week.emailsSent],
                  ["Email replies", week.emailsReplied],
                ]}
              />
              <div>
                <Stats
                  heading="This month"
                  items={[
                    ["Deals won", month.won],
                    ["Deals lost", month.lost],
                  ]}
                />
                <p className="pt-1.5 text-xs text-muted-foreground">
                  {decided === 0
                    ? "No deals closed this month yet."
                    : `Win rate ${percent(month.won, decided)} of ${decided} closed.`}
                </p>
              </div>
            </div>
          </Panel>
        </div>

        <Queue queue={summary.todaysQueue} />
      </div>
    </div>
  );
}

const CARD_LINK =
  "group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Horizontal bars as a share of `total` (not of the largest bar), with count and percent. */
function Bars({
  items,
  total,
  link,
}: {
  items: StageCount<string>[];
  total: number;
  link: (stage: string, body: ReactNode) => ReactNode;
}) {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.stage}>
          {link(
            item.stage,
            <span className="flex items-center gap-3 rounded-md px-1 py-1 hover:bg-accent/60">
              <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">
                {label(item.stage)}
              </span>
              <span
                className="h-4 flex-1 overflow-hidden rounded bg-muted"
                role="img"
                aria-label={`${label(item.stage)}: ${item.count} of ${total}`}
              >
                <span
                  className="block h-full rounded bg-primary/80"
                  style={{
                    width: `${item.count === 0 ? 0 : Math.max((item.count / total) * 100, 2)}%`,
                  }}
                />
              </span>
              <span className="num w-9 text-right text-sm font-medium">{item.count}</span>
              <span className="num w-9 text-right text-xs text-muted-foreground">
                {percent(item.count, total)}
              </span>
            </span>,
          )}
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

function Empty({ text, to, cta }: { text: string; to: "/contacts" | "/deals"; cta: string }) {
  return (
    <ListEmptyState compact icon={to === "/contacts" ? Users : Handshake} title={text} text="">
      <Link to={to} className="text-sm text-primary hover:underline">
        {cta}
      </Link>
    </ListEmptyState>
  );
}

// Call and meeting tasks are done on their deal page, by logging the call or booking it.
const doneOnDeal = (t: DashboardSummary["todaysQueue"][number]) =>
  (t.type === "call" || t.type === "schedule_meeting") && t.dealId;

/** The signed-in user's own open tasks due today, with the next step inline. */
function Queue({ queue }: { queue: DashboardSummary["todaysQueue"] }) {
  const complete = useCrmMutation((id: string) => backend.tasks.complete(id));
  return (
    <Panel
      title={`My queue today (${queue.length})`}
      action={
        <Button size="sm" variant="ghost" asChild>
          <Link to="/tasks" search={{ view: "today" }}>
            All tasks
          </Link>
        </Button>
      }
    >
      {queue.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="size-8 text-success" />
          <p className="mt-2 text-sm font-medium">Nothing due today.</p>
          <p className="text-xs text-muted-foreground">
            Check{" "}
            <Link to="/tasks" search={{ view: "overdue" }} className="text-primary hover:underline">
              overdue
            </Link>{" "}
            or{" "}
            <Link
              to="/tasks"
              search={{ view: "upcoming" }}
              className="text-primary hover:underline"
            >
              upcoming
            </Link>{" "}
            tasks.
          </p>
        </div>
      ) : (
        <ul className="-my-2 divide-y">
          {queue.map((task) => (
            <li key={task.id} className="flex items-center gap-3 py-2">
              <span className="num w-16 shrink-0 text-xs text-muted-foreground">
                {fmtTime(task.dueAt)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{task.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {task.dealId ? (
                    <Link
                      to="/deals/$dealId"
                      params={{ dealId: task.dealId }}
                      className="hover:underline"
                    >
                      {task.contactName ?? "Deal"}
                    </Link>
                  ) : task.contactId ? (
                    <Link
                      to="/contacts/$contactId"
                      params={{ contactId: task.contactId }}
                      className="hover:underline"
                    >
                      {task.contactName ?? "Contact"}
                    </Link>
                  ) : (
                    "-"
                  )}
                </div>
              </div>
              <span className="hidden sm:inline-flex">
                <StatusBadge value={task.type} tone="neutral" />
              </span>
              {doneOnDeal(task) ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to="/deals/$dealId" params={{ dealId: task.dealId! }}>
                    {task.type === "call" ? "Log call" : "Book meeting"}
                  </Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={complete.isPending}
                  onClick={() =>
                    complete.mutate(task.id, {
                      onSuccess: () => toast.success("Task completed"),
                      onError: (e) => toast.error(messageFromError(e)),
                    })
                  }
                >
                  Complete
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
