import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/common/list-controls";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { findCurrentStep } from "@/lib/workflow-timeline";
import { messageFromError, useAutomations, useRuns, useScheduledActions } from "@/store";
import { DealLink } from "@/features/deals/deal-link";

const PAGE_SIZE = 50;

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
  const searchParam = search || undefined;
  const runs = useRuns({ search: searchParam, limit: PAGE_SIZE, offset });
  const actions = useScheduledActions({
    search: searchParam,
    limit: PAGE_SIZE,
    offset: actionsOffset,
  });
  const runRows = runs.data?.data ?? [];
  const runTotal = runs.data?.total ?? 0;
  const actionRows = actions.data?.data ?? [];
  const actionTotal = actions.data?.total ?? 0;

  return (
    <div className="pb-10">
      <PageHeader
        title="Automations"
        description="Runs and scheduled actions are authoritative backend execution state."
        tabs={<AutomationTabs />}
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
          <div className="text-xs text-muted-foreground">
            {runTotal} {search ? "matching " : ""}runs
          </div>
        </div>

        {runs.isLoading ? (
          <LoadingBlock label="Loading runs…" />
        ) : runs.error ? (
          <ErrorBlock error={runs.error} />
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Deal",
                      "Workflow",
                      "Current step",
                      "Status",
                      "Started",
                      "Next action",
                      "",
                    ].map((heading) => (
                      <th key={heading} className="px-3 py-2 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runRows.map((run) => {
                    const workflow = workflows.find((item) => item.id === run.workflowId);
                    const currentStep = findCurrentStep(workflow, run);
                    const currentStepLabel = currentStep
                      ? label(currentStep.action)
                      : ["running", "waiting"].includes(run.status)
                        ? "No enabled steps configured"
                        : label(run.currentStep);
                    return (
                      <tr key={run.id} className="border-t hover:bg-accent/40">
                        <td className="px-3 py-2 text-xs">
                          <DealLink
                            dealId={run.dealId}
                            contactName={run.contactName}
                            companyName={run.companyName}
                          />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {workflow?.name ?? run.workflowId} V{run.version}
                        </td>
                        <td className="px-3 py-2">
                          {currentStepLabel}
                          {run.lastError && (
                            <div className="text-xs text-destructive">{run.lastError}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge value={run.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {relDay(run.startedAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {run.nextRunAt ? relDay(run.nextRunAt) : "-"}
                        </td>
                        <td className="space-x-1 px-3 py-2 text-right">
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
                        </td>
                      </tr>
                    );
                  })}
                  {runRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                      >
                        {search ? `No runs match "${search}".` : "No workflow runs."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <Pager offset={offset} pageSize={PAGE_SIZE} total={runTotal} onOffset={setOffset} />

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="border-b px-4 py-3 text-sm font-medium">Scheduled actions</div>
            {actions.isLoading ? (
              <LoadingBlock label="Loading scheduled actions…" />
            ) : actions.error ? (
              <ErrorBlock error={actions.error} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                    <tr>
                      {["Deal", "Action", "Scheduled for", "Status", "Attempts / error"].map(
                        (heading) => (
                          <th key={heading} className="px-3 py-2 font-medium">
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {actionRows.map((action) => (
                      <tr key={action.id} className="border-t">
                        <td className="px-3 py-2 text-xs">
                          <DealLink
                            dealId={action.dealId}
                            contactName={action.contactName}
                            companyName={action.companyName}
                          />
                        </td>
                        <td className="px-3 py-2">{label(action.actionType)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {relDay(action.scheduledFor)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge value={action.status} />
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {action.attemptCount}/{action.maxAttempts}
                          {action.lastError ? ` · ${action.lastError}` : ""}
                        </td>
                      </tr>
                    ))}
                    {actionRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-8 text-center text-sm text-muted-foreground"
                        >
                          {search
                            ? `No scheduled actions match "${search}".`
                            : "No scheduled actions."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <Pager
          offset={actionsOffset}
          pageSize={PAGE_SIZE}
          total={actionTotal}
          onOffset={setActionsOffset}
        />
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
