import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { findCurrentStep } from "@/lib/workflow-timeline";
import { messageFromError, useAutomations, useLeads } from "@/store";

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
  const { leads } = useLeads();

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
            <Card className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                    <tr>
                      {[
                        "Lead",
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
                    {runs.map((run) => {
                      const lead = leads.find((item) => item.id === run.leadId);
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
                            {lead ? (
                              <Link
                                to="/leads/$leadId"
                                params={{ leadId: lead.id }}
                                className="hover:underline"
                              >
                                {lead.firstName} {lead.lastName} · {lead.company}
                              </Link>
                            ) : (
                              run.leadId
                            )}
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
                    {runs.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-10 text-center text-sm text-muted-foreground"
                        >
                          No workflow runs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="border-b px-4 py-3 text-sm font-medium">Scheduled actions</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        {["Lead", "Action", "Scheduled for", "Status", "Attempts / error"].map(
                          (heading) => (
                            <th key={heading} className="px-3 py-2 font-medium">
                              {heading}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {scheduledActions.map((action) => {
                        const lead = leads.find((item) => item.id === action.leadId);
                        return (
                          <tr key={action.id} className="border-t">
                            <td className="px-3 py-2 text-xs">
                              {lead ? `${lead.firstName} ${lead.lastName}` : action.leadId}
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
                      {scheduledActions.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-8 text-center text-sm text-muted-foreground"
                          >
                            No scheduled actions.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
