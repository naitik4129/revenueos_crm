import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Search, Workflow } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  RelTime,
  ListEmptyState,
  Pager,
  RecordTable,
  ViewTabs,
  type ListColumn,
} from "@/components/common/list-controls";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { label } from "@/lib/labels";
import { findCurrentStep } from "@/lib/workflow-timeline";
import { messageFromError, useAutomations, useRuns, useScheduledActions } from "@/store";
import { DealLink } from "@/features/deals/deal-link";
import { RUN_STATUSES, type Run, type ScheduledAction } from "@/types";
import { countLabel } from "@/lib/format";

const PAGE_SIZE = 50;
const ALL = "all";

export function RunsPage() {
  const { workflows, pauseRun, resumeRun, cancelRun, retryRun, isPending } = useAutomations();
  const [q, setQ] = useState("");
  // Search (contact or company name) runs on the server; typing pauses before each request.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const [offset, setOffset] = useState(0);
  const [actionsOffset, setActionsOffset] = useState(0);
  const [status, setStatus] = useState(ALL);
  const searchParam = search || undefined;
  const runs = useRuns({
    search: searchParam,
    status: status === ALL ? undefined : status,
    limit: PAGE_SIZE,
    offset,
  });
  const actions = useScheduledActions({
    search: searchParam,
    limit: PAGE_SIZE,
    offset: actionsOffset,
  });
  const runRows = runs.data?.data ?? [];
  const runTotal = runs.data?.total ?? 0;
  const actionRows = actions.data?.data ?? [];
  const actionTotal = actions.data?.total ?? 0;

  const runColumns: ListColumn<Run>[] = [
    {
      id: "workflow",
      label: "Workflow",
      cell: (run) =>
        `${workflows.find((w) => w.id === run.workflowId)?.name ?? run.workflowId} V${run.version}`,
    },
    {
      id: "step",
      label: "Current step",
      cell: (run) => {
        const currentStep = findCurrentStep(
          workflows.find((w) => w.id === run.workflowId),
          run,
        );
        return (
          <div>
            {currentStep
              ? label(currentStep.action)
              : ["running", "waiting"].includes(run.status)
                ? "No enabled steps configured"
                : label(run.currentStep)}
            {run.lastError && (
              <div className="whitespace-normal text-destructive">{run.lastError}</div>
            )}
          </div>
        );
      },
    },
    { id: "status", label: "Status", cell: (run) => <StatusBadge value={run.status} /> },
    { id: "started", label: "Started", cell: (run) => <RelTime iso={run.startedAt} /> },
    {
      id: "next",
      label: "Next action",
      cell: (run) => (run.nextRunAt ? <RelTime iso={run.nextRunAt} /> : undefined),
    },
  ];
  const actionColumns: ListColumn<ScheduledAction>[] = [
    { id: "action", label: "Action", cell: (a) => label(a.actionType) },
    { id: "when", label: "Scheduled for", cell: (a) => <RelTime iso={a.scheduledFor} /> },
    { id: "status", label: "Status", cell: (a) => <StatusBadge value={a.status} /> },
    {
      id: "attempts",
      label: "Attempts / error",
      cell: (a) => `${a.attemptCount}/${a.maxAttempts}${a.lastError ? ` · ${a.lastError}` : ""}`,
    },
  ];
  const dealCell = (row: Run | ScheduledAction) => (
    <DealLink dealId={row.dealId} contactName={row.contactName} companyName={row.companyName} />
  );

  return (
    <div className="pb-10">
      <PageHeader
        title="Automations"
        description="Runs and scheduled actions are the backend worker's live state."
        count={runs.isLoading ? undefined : countLabel(runTotal, "run")}
        tabs={<AutomationTabs />}
      />

      <div className="space-y-4 px-6 py-4">
        <Card className="overflow-hidden p-0">
          <div className="border-b px-3">
            <ViewTabs
              views={[
                { id: ALL, label: "All runs" },
                ...RUN_STATUSES.map((s) => ({ id: s, label: s[0]!.toUpperCase() + s.slice(1) })),
              ]}
              active={status}
              onSelect={(id) => {
                setStatus(id);
                setOffset(0);
              }}
            />
          </div>
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOffset(0);
                  setActionsOffset(0);
                }}
                placeholder="Search by contact or company"
                aria-label="Search runs"
                className="pl-8"
              />
            </div>
          </div>

          {runs.isLoading ? (
            <LoadingBlock label="Loading runs…" />
          ) : runs.error ? (
            <ErrorBlock error={runs.error} />
          ) : runRows.length === 0 ? (
            <ListEmptyState
              icon={Workflow}
              title={search ? `No runs match "${search}".` : "No workflow runs."}
              text="A run starts when a deal enters a workflow, by its trigger or by hand from the deal page."
            />
          ) : (
            <RecordTable
              rows={runRows}
              columns={runColumns}
              nameHeader="Deal"
              rowLabel={(run) => run.contactName ?? run.id}
              name={dealCell}
              actions={(run) => (
                <span className="flex justify-end gap-1">
                  {run.status === "failed" && (
                    <Action
                      label="Retry"
                      disabled={isPending}
                      onClick={() => mutate(() => retryRun(run.id), "Run retried")}
                    />
                  )}
                  {(run.status === "running" || run.status === "waiting") && (
                    <Action
                      label="Pause"
                      disabled={isPending}
                      onClick={() => mutate(() => pauseRun(run.id), "Run paused")}
                    />
                  )}
                  {run.status === "paused" && (
                    <Action
                      label="Resume"
                      disabled={isPending}
                      onClick={() => mutate(() => resumeRun(run.id), "Run resumed")}
                    />
                  )}
                  {["running", "waiting", "paused", "failed"].includes(run.status) && (
                    <Action
                      label="Cancel"
                      disabled={isPending}
                      onClick={() => mutate(() => cancelRun(run.id), "Run cancelled")}
                    />
                  )}
                </span>
              )}
            />
          )}
          {runTotal > 0 && (
            <div className="border-t px-3 py-2">
              <Pager offset={offset} pageSize={PAGE_SIZE} total={runTotal} onOffset={setOffset} />
            </div>
          )}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex min-h-11 items-center justify-between border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Scheduled actions</h2>
            <span className="text-xs text-muted-foreground">
              {actionTotal} {search ? "matching" : "queued or done"}
            </span>
          </div>
          {actions.isLoading ? (
            <LoadingBlock label="Loading scheduled actions…" />
          ) : actions.error ? (
            <ErrorBlock error={actions.error} />
          ) : actionRows.length === 0 ? (
            <ListEmptyState
              compact
              icon={CalendarClock}
              title={search ? `No scheduled actions match "${search}".` : "No scheduled actions."}
              text="Sends and tasks a workflow has queued for later show here."
            />
          ) : (
            <RecordTable
              rows={actionRows}
              columns={actionColumns}
              nameHeader="Deal"
              rowLabel={(a) => a.contactName ?? a.id}
              name={dealCell}
            />
          )}
          {actionTotal > 0 && (
            <div className="border-t px-3 py-2">
              <Pager
                offset={actionsOffset}
                pageSize={PAGE_SIZE}
                total={actionTotal}
                onOffset={setActionsOffset}
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Action({
  label: text,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" disabled={disabled} onClick={onClick}>
      {text}
    </Button>
  );
}

async function mutate(work: () => Promise<unknown>, success: string) {
  try {
    await work();
    toast.success(success);
  } catch (failure) {
    toast.error(messageFromError(failure));
  }
}
