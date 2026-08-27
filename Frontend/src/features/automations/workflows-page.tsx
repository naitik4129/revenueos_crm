import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bot, Copy, Plus } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/common/status-badge";
import { relDay } from "@/lib/format";
import { useAutomations, useSession } from "@/store";

export function WorkflowsPage() {
  const { workflows, updateWorkflow, duplicateWorkflow } = useAutomations();
  const { userName } = useSession();

  return (
    <div className="pb-10">
      <PageHeader
        title="Automations"
        description="Workflows are defined here and executed by n8n. Publishing a version changes live behaviour."
        tabs={<AutomationTabs />}
        actions={
          <Button size="sm" onClick={() => toast.success("New workflow draft created")}>
            <Plus className="mr-1 size-4" /> New workflow
          </Button>
        }
      />

      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        {workflows.map((w) => {
          const draft = w.versions.find((v) => v.status === "Draft");
          const published = w.versions.find((v) => v.version === w.currentVersion);
          return (
            <Card key={w.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{w.name}</CardTitle>
                  <Switch
                    checked={w.status === "Active"}
                    onCheckedChange={(v) => {
                      updateWorkflow(w.id, { status: v ? "Active" : "Paused" });
                      toast.success(v ? "Workflow activated" : "Workflow paused");
                    }}
                  />
                </div>
                <p className="pt-1 text-xs text-muted-foreground">{w.description}</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge value={w.status} dot />
                  <StatusBadge value={`V${w.currentVersion} published`} tone="info" />
                  {draft && <StatusBadge value={`V${draft.version} draft`} tone="warning" />}
                </div>

                <div className="rounded-md border px-3 py-2 text-xs">
                  <div className="text-muted-foreground">Trigger</div>
                  <div className="pt-0.5 font-medium">{w.trigger}</div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <Metric label="Steps" value={String(published?.steps.length ?? 0)} />
                  <Metric label="Active leads" value={String(w.activeLeads)} />
                  <Metric label="Failures" value={String(w.failures)} />
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-muted-foreground">
                    {userName(w.ownerId)} · {relDay(w.updatedAt)}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        duplicateWorkflow(w.id);
                        toast.success("Workflow duplicated");
                      }}
                      aria-label="Duplicate workflow"
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/automations/workflows/$workflowId" params={{ workflowId: w.id }}>
                        Edit steps
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        <Card className="border-dashed">
          <CardContent className="flex h-full flex-col justify-center gap-2 py-8 text-center">
            <Bot className="mx-auto size-5 text-muted-foreground" />
            <p className="text-sm font-medium">Managers own the automation</p>
            <p className="text-xs text-muted-foreground">
              Add or reorder steps, change delays and swap templates here — no developer needs to
              touch n8n.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border py-2">
      <div className="num text-sm font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
