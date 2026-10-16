import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { findCurrentStep } from "@/lib/workflow-timeline";
import { messageFromError, useAutomations } from "@/store";
import { DealLink } from "@/features/deals/deal-link";

const RUNS_PAGE_SIZE = 10;
const ACTIONS_PAGE_SIZE = 10;

export function RunsPage() {
  const {
    runs,
    workflows,
    scheduledActions,
    pauseRun,
    resumeRun,
    cancelRun,
    retryRun,
    isLoading,
    error,
    isPending,
  } = useAutomations();
  // Search matches the deal's contact and company names.
  const dealText = (row: { contactName?: string; companyName?: string }) =>
    `${row.contactName ?? ""} ${row.companyName ?? ""}`;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [actionsPage, setActionsPage] = useState(1);

  const query = q.trim().toLowerCase();
  const filteredRuns = query
    ? runs.filter((run) => dealText(run).toLowerCase().includes(query))
    : runs;

  const filteredScheduledActions = query
    ? scheduledActions.filter((action) => dealText(action).toLowerCase().includes(query))
    : scheduledActions;

  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / RUNS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRuns = useMemo(
    () => filteredRuns.slice((currentPage - 1) * RUNS_PAGE_SIZE, currentPage * RUNS_PAGE_SIZE),
    [filteredRuns, currentPage],
  );

  const totalActionsPages = Math.max(
    1,
    Math.ceil(filteredScheduledActions.length / ACTIONS_PAGE_SIZE),
  );
  const currentActionsPage = Math.min(actionsPage, totalActionsPages);
  const pagedScheduledActions = useMemo(
    () =>
      filteredScheduledActions.slice(
        (currentActionsPage - 1) * ACTIONS_PAGE_SIZE,
        currentActionsPage * ACTIONS_PAGE_SIZE,
      ),
    [filteredScheduledActions, currentActionsPage],
  );

  return (
    <div className="pb-10">
      <PageHeader
        title="Automations"
        description="Runs and scheduled actions are authoritative backend execution state."
        tabs={<AutomationTabs />}
      />

      <div className="space-y-4 p-6">
        {isLoading ? (
          <LoadingBlock label="Loading runs…" />
        ) : error ? (
          <ErrorBlock error={error} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                    setActionsPage(1);
                  }}
                  placeholder="Search by contact or company"
                  className="pl-8"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {filteredRuns.length} of {runs.length} runs
              </div>
            </div>

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
                    {pagedRuns.map((run) => {
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
                    {filteredRuns.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-10 text-center text-sm text-muted-foreground"
                        >
                          {runs.length === 0 ? "No workflow runs." : `No runs match "${q}".`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filteredRuns.length > 0 && (
                <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Showing {(currentPage - 1) * RUNS_PAGE_SIZE + 1}-
                    {Math.min(currentPage * RUNS_PAGE_SIZE, filteredRuns.length)} of{" "}
                    {filteredRuns.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span>
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage === totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="border-b px-4 py-3 text-sm font-medium">Scheduled actions</div>
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
                      {pagedScheduledActions.map((action) => {
                        return (
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
                        );
                      })}
                      {filteredScheduledActions.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-8 text-center text-sm text-muted-foreground"
                          >
                            {scheduledActions.length === 0
                              ? "No scheduled actions."
                              : `No scheduled actions match "${q}".`}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {filteredScheduledActions.length > 0 && (
                  <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      Showing {(currentActionsPage - 1) * ACTIONS_PAGE_SIZE + 1}-
                      {Math.min(
                        currentActionsPage * ACTIONS_PAGE_SIZE,
                        filteredScheduledActions.length,
                      )}{" "}
                      of {filteredScheduledActions.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={currentActionsPage === 1}
                        onClick={() => setActionsPage((p) => Math.max(1, p - 1))}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <span>
                        Page {currentActionsPage} of {totalActionsPages}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={currentActionsPage === totalActionsPages}
                        onClick={() => setActionsPage((p) => Math.min(totalActionsPages, p + 1))}
                        aria-label="Next page"
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
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
