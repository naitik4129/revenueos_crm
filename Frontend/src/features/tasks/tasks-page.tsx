import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { Pager } from "@/components/common/list-controls";
import { isOverdue, relDay } from "@/lib/format";
import type { TaskListParams } from "@/lib/backend-client";
import { useSession, useTasks, useTaskTotals } from "@/store";
import { messageFromError } from "@/store";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { DealLink } from "@/features/deals/deal-link";

const PAGE_SIZE = 50;

// The tabs are server filters (Asia/Kolkata days), so they agree with the dashboard.
const VIEWS = {
  today: { dueTodayOnly: true },
  overdue: { overdueOnly: true },
  upcoming: { upcomingOnly: true },
  done: { status: "completed" },
} satisfies Record<string, TaskListParams>;
type View = keyof typeof VIEWS;
const VIEW_NAMES = Object.keys(VIEWS) as View[];

export function TasksPage() {
  const { users, userName } = useSession();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("today");
  const [owner, setOwner] = useState("all");
  const [offset, setOffset] = useState(0);
  const ownerId = owner === "all" ? undefined : owner;
  const { tasks, total, completeTask, isLoading, error, isPending } = useTasks({
    ...VIEWS[view],
    ownerId,
    limit: PAGE_SIZE,
    offset,
  });
  const totals = useTaskTotals(VIEW_NAMES.map((name) => ({ ...VIEWS[name], ownerId })));
  const count = (name: View) => totals[VIEW_NAMES.indexOf(name)] ?? "�";

  return (
    <div className="pb-10">
      <PageHeader
        title="Tasks"
        description="Manual and automation-created actions. Call and meeting tasks open their deal, where you log the call or schedule the meeting."
        tabs={
          <Tabs
            value={view}
            onValueChange={(v) => {
              setView(v as View);
              setOffset(0);
            }}
          >
            <TabsList>
              <TabsTrigger value="today">Today ({count("today")})</TabsTrigger>
              <TabsTrigger value="overdue">Overdue ({count("overdue")})</TabsTrigger>
              <TabsTrigger value="upcoming">Upcoming ({count("upcoming")})</TabsTrigger>
              <TabsTrigger value="done">Completed ({count("done")})</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        actions={
          <Select
            value={owner}
            onValueChange={(value) => {
              setOwner(value);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="space-y-3 p-6">
        {isLoading ? (
          <LoadingBlock label="Loading tasks…" />
        ) : error ? (
          <ErrorBlock error={error} />
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {["", "Task", "Deal / contact", "Type", "Due", "Owner", "Origin"].map(
                      (h, i) => (
                        <th key={i} className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    return (
                      <tr key={t.id} className="border-t hover:bg-accent/40">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={t.done}
                            disabled={t.status !== "open" || isPending}
                            onCheckedChange={() => {
                              if (t.status !== "open") return;
                              // These are done by logging the call / scheduling on the deal page.
                              if (
                                (t.type === "call" || t.type === "schedule_meeting") &&
                                t.dealId
                              ) {
                                void navigate({
                                  to: "/deals/$dealId",
                                  params: { dealId: t.dealId },
                                });
                                return;
                              }
                              void completeTask(t.id).catch((reason) => toastError(reason));
                            }}
                          />
                        </td>
                        <td
                          className={`px-3 py-2 ${t.done ? "text-muted-foreground line-through" : ""}`}
                        >
                          {t.title}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <DealLink
                            dealId={t.dealId}
                            contactId={t.contactId}
                            contactName={t.contactName}
                            companyName={t.companyName}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge value={t.type} tone="neutral" />
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-xs ${
                            !t.done && isOverdue(t.dueAt)
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                        >
                          {relDay(t.dueAt)}
                        </td>
                        <td className="px-3 py-2 text-xs">{userName(t.ownerId)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            value={t.origin}
                            tone={t.origin === "automation" ? "primary" : "muted"}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {tasks.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                      >
                        Nothing here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <Pager offset={offset} pageSize={PAGE_SIZE} total={total} onOffset={setOffset} />
      </div>
    </div>
  );
}

function toastError(error: unknown) {
  toast.error(messageFromError(error));
}
