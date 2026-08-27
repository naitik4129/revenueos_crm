import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/status-badge";
import { relDay } from "@/lib/format";
import { useAutomations, useLeads } from "@/store";

export function RunsPage() {
  const { runs, workflows, updateRun } = useAutomations();
  const { leads } = useLeads();

  return (
    <div className="pb-10">
      <PageHeader
        title="Automations"
        description="Runs are created when a lead enters a workflow and stop as soon as the lead replies or converts."
        tabs={<AutomationTabs />}
      />

      <div className="space-y-4 p-6">
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  {["Lead", "Workflow", "Current step", "Status", "Started", "Next action", ""].map(
                    (h, i) => (
                      <th key={i} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const lead = leads.find((l) => l.id === r.leadId);
                  const wf = workflows.find((w) => w.id === r.workflowId);
                  return (
                    <tr key={r.id} className="border-t hover:bg-accent/40">
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
                      <td className="px-3 py-2 text-xs">
                        {wf?.name} V{r.version}
                      </td>
                      <td className="px-3 py-2">
                        {r.currentStep}
                        {r.lastError && (
                          <div className="text-xs text-destructive">{r.lastError}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge value={r.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {relDay(r.startedAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {r.nextRunAt ? relDay(r.nextRunAt) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.status === "Failed" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              updateRun(r.id, { status: "Running", lastError: undefined });
                              toast.success("Run retried");
                            }}
                          >
                            Retry
                          </Button>
                        ) : r.status === "Running" || r.status === "Waiting" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              updateRun(r.id, { status: "Paused" });
                              toast.success("Run paused");
                            }}
                          >
                            Pause
                          </Button>
                        ) : r.status === "Paused" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              updateRun(r.id, { status: "Running" });
                              toast.success("Run resumed");
                            }}
                          >
                            Resume
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardContent className="text-xs text-muted-foreground">
            Before every step n8n re-checks the lead: still active, not suppressed, no newer reply
            and no meeting booked. If any check fails the run is cancelled instead of sending.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
