import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/status-badge";
import {
  FilterSelect,
  ListEmptyState,
  Pager,
  RecordTable,
  ViewTabs,
  type ListColumn,
} from "@/components/common/list-controls";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { isOverdue, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import type { TaskListParams } from "@/lib/backend-client";
import { messageFromError, useSession, useTasks, useTaskTotals } from "@/store";
import { TASK_TYPES, type Task } from "@/types";
import { DealLink } from "@/features/deals/deal-link";
import { TaskDialog } from "@/features/deals/deal-dialogs";

const PAGE_SIZE = 50;
const ALL = "all";

// The tabs are server filters (Asia/Kolkata days), so they agree with the dashboard.
const VIEWS = {
  today: { dueTodayOnly: true },
  overdue: { overdueOnly: true },
  upcoming: { upcomingOnly: true },
  done: { status: "completed" },
} satisfies Record<string, TaskListParams>;
type View = keyof typeof VIEWS;
const VIEW_NAMES = Object.keys(VIEWS) as View[];
const VIEW_LABELS: Record<View, string> = {
  today: "Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  done: "Done",
};
const EMPTY: Record<View, string> = {
  today: "Nothing due today.",
  overdue: "Nothing overdue.",
  upcoming: "Nothing coming up.",
  done: "No completed tasks yet.",
};

// Call and meeting tasks are done on their deal page, by logging the call or booking it.
const doneOnDeal = (t: Task) => (t.type === "call" || t.type === "schedule_meeting") && t.dealId;

export function TasksPage() {
  const { users, userName } = useSession();
  const [view, setView] = useState<View>("today");
  const [owner, setOwner] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [rescheduling, setRescheduling] = useState<Task | null>(null);
  const filters = {
    ownerId: owner === ALL ? undefined : owner,
    type: type === ALL ? undefined : type,
  };
  const { tasks, total, completeTask, isLoading, error, isPending } = useTasks({
    ...VIEWS[view],
    ...filters,
    limit: PAGE_SIZE,
    offset,
  });
  const totals = useTaskTotals(VIEW_NAMES.map((name) => ({ ...VIEWS[name], ...filters })));
  const count = (name: View) => totals[VIEW_NAMES.indexOf(name)];

  const columns: ListColumn<Task>[] = [
    {
      id: "deal",
      label: "Deal / contact",
      cell: (t) =>
        (t.dealId ?? t.contactId) && (
          <DealLink
            dealId={t.dealId}
            contactId={t.contactId}
            contactName={t.contactName}
            companyName={t.companyName}
          />
        ),
    },
    { id: "type", label: "Type", cell: (t) => <StatusBadge value={t.type} tone="neutral" /> },
    {
      id: "due",
      label: view === "done" ? "Completed" : "Due",
      cell: (t) =>
        view === "done" ? (
          relDay(t.completedAt ?? t.dueAt)
        ) : (
          <span className={isOverdue(t.dueAt) ? "text-destructive" : undefined}>
            {relDay(t.dueAt)}
          </span>
        ),
    },
    { id: "owner", label: "Owner", cell: (t) => userName(t.ownerId) },
    {
      id: "origin",
      label: "Origin",
      cell: (t) => (
        <StatusBadge value={t.origin} tone={t.origin === "automation" ? "primary" : "muted"} />
      ),
    },
  ];

  const complete = (t: Task) =>
    completeTask(t.id).then(
      () => toast.success("Task completed"),
      (reason: unknown) => toast.error(messageFromError(reason)),
    );

  return (
    <div className="pb-10">
      <PageHeader
        title="Tasks"
        description="Manual and automation tasks. Call and meeting tasks open their deal, where you log the call or book the meeting."
        tabs={
          <ViewTabs
            views={VIEW_NAMES.map((id) => ({
              id,
              label: `${VIEW_LABELS[id]}${count(id) === undefined ? "" : ` (${count(id)})`}`,
            }))}
            active={view}
            onSelect={(id) => {
              setView(id as View);
              setOffset(0);
            }}
          />
        }
      />
      {rescheduling && (
        <TaskDialog task={rescheduling} onOpenChange={(open) => !open && setRescheduling(null)} />
      )}

      <div className="px-6 py-4">
        <Card className="overflow-hidden p-0">
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
            <FilterSelect
              label="Owner"
              value={owner}
              onChange={(v) => {
                setOwner(v);
                setOffset(0);
              }}
              options={[[ALL, "All owners"], ...users.map((u) => [u.id, u.name] as const)]}
            />
            <FilterSelect
              label="Task type"
              value={type}
              onChange={(v) => {
                setType(v);
                setOffset(0);
              }}
              options={[[ALL, "All types"], ...TASK_TYPES.map((t) => [t, label(t)] as const)]}
            />
          </div>

          {isLoading ? (
            <LoadingBlock label="Loading tasks…" />
          ) : error ? (
            <ErrorBlock error={error} />
          ) : tasks.length === 0 ? (
            <ListEmptyState
              icon={ListChecks}
              title={EMPTY[view]}
              text="Tasks come from deals, contacts and automation steps."
            />
          ) : (
            <RecordTable
              rows={tasks}
              columns={columns}
              nameHeader="Task"
              rowLabel={(t) => t.title}
              name={(t) => (
                <span className={t.done ? "text-muted-foreground line-through" : "font-medium"}>
                  {t.title}
                </span>
              )}
              actions={(t) =>
                t.status === "open" && (
                  <span className="flex justify-end gap-1">
                    {doneOnDeal(t) ? (
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/deals/$dealId" params={{ dealId: t.dealId! }}>
                          {t.type === "call" ? "Log call" : "Book meeting"}
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => void complete(t)}
                      >
                        Complete
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setRescheduling(t)}>
                      Reschedule
                    </Button>
                  </span>
                )
              }
            />
          )}

          {total > 0 && (
            <div className="border-t px-3 py-2">
              <Pager offset={offset} pageSize={PAGE_SIZE} total={total} onOffset={setOffset} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
