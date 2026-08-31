import { useState } from "react";
import { Link } from "@tanstack/react-router";
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
import { isOverdue, isToday, relDay } from "@/lib/format";
import { useLeads, useSession, useTasks } from "@/store";
import { messageFromError } from "@/store";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { LogCallDialog } from "@/features/leads/log-call-dialog";

type View = "today" | "overdue" | "upcoming" | "done";

export function TasksPage() {
  const { tasks, completeTask, isLoading, error, isPending } = useTasks();
  const { leads } = useLeads();
  const { users, userName } = useSession();
  const [view, setView] = useState<View>("today");
  const [owner, setOwner] = useState("all");
  const [callTask, setCallTask] = useState<{ leadId: string; taskId: string } | null>(null);

  const filtered = tasks.filter((t) => {
    if (owner !== "all" && t.ownerId !== owner) return false;
    if (view === "done") return t.status === "completed";
    if (t.status !== "open") return false;
    if (view === "today") return isToday(t.dueAt);
    if (view === "overdue") return isOverdue(t.dueAt);
    return !isOverdue(t.dueAt) && !isToday(t.dueAt);
  });

  const counts = {
    today: tasks.filter((t) => t.status === "open" && isToday(t.dueAt)).length,
    overdue: tasks.filter((t) => t.status === "open" && isOverdue(t.dueAt)).length,
    upcoming: tasks.filter((t) => t.status === "open" && !isOverdue(t.dueAt) && !isToday(t.dueAt))
      .length,
    done: tasks.filter((t) => t.status === "completed").length,
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Tasks"
        description="Manual and automation-created actions. Completing a task keeps the lead moving."
        tabs={
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="today">Today ({counts.today})</TabsTrigger>
              <TabsTrigger value="overdue">Overdue ({counts.overdue})</TabsTrigger>
              <TabsTrigger value="upcoming">Upcoming ({counts.upcoming})</TabsTrigger>
              <TabsTrigger value="done">Completed ({counts.done})</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        actions={
          <Select value={owner} onValueChange={setOwner}>
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

      <div className="p-6">
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
                    {["", "Task", "Lead", "Type", "Due", "Owner", "Origin"].map((h, i) => (
                      <th key={i} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const lead = leads.find((l) => l.id === t.leadId);
                    return (
                      <tr key={t.id} className="border-t hover:bg-accent/40">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={t.done}
                            disabled={t.status !== "open" || isPending}
                            onCheckedChange={() => {
                              if (t.status !== "open") return;
                              if (t.type === "call") {
                                setCallTask({ leadId: t.leadId, taskId: t.id });
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
                  {filtered.length === 0 && (
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
      </div>
      {callTask && (
        <LogCallDialog
          leadId={callTask.leadId}
          taskId={callTask.taskId}
          open={true}
          onOpenChange={(value) => {
            if (!value) setCallTask(null);
          }}
        />
      )}
    </div>
  );
}

function toastError(error: unknown) {
  toast.error(messageFromError(error));
}
