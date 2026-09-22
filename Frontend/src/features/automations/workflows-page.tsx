import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, Copy, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/common/status-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { relDay } from "@/lib/format";
import { useAutomations, useSession } from "@/store";
import { messageFromError } from "@/store";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { workflowTriggerLabel } from "@/lib/labels";
import { BackendError } from "@/lib/backend-client";
import { WORKFLOW_TRIGGERS, type Workflow, type WorkflowTrigger } from "@/types";

export function WorkflowsPage() {
  const {
    workflows,
    updateWorkflow,
    duplicateWorkflow,
    deleteWorkflow,
    addWorkflow,
    isLoading,
    error,
    isPending,
  } = useAutomations();
  const { userName } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  const [forceDeleteTarget, setForceDeleteTarget] = useState<Workflow | null>(null);
  const [q, setQ] = useState("");
  const mutate = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      toast.success(success);
    } catch (failure) {
      toast.error(messageFromError(failure));
    }
  };

  const filteredWorkflows = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return workflows;
    return workflows.filter((w) =>
      `${w.name} ${w.description ?? ""} ${workflowTriggerLabel(w.trigger)}`
        .toLowerCase()
        .includes(query),
    );
  }, [workflows, q]);

  return (
    <div className="pb-10">
      <PageHeader
        title="Automations"
        description="Workflows are defined here and executed by the backend automation worker. Publishing a version changes live behaviour."
        tabs={<AutomationTabs />}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" /> New workflow
          </Button>
        }
      />

      <div className="px-6 pt-6">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workflows"
            className="pl-8"
          />
        </div>
      </div>

      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <LoadingBlock label="Loading workflows…" />
        ) : error ? (
          <ErrorBlock error={error} />
        ) : filteredWorkflows.length === 0 ? (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            No workflows match &quot;{q}&quot;.
          </p>
        ) : (
          <>
            {filteredWorkflows.map((w) => {
              const draft = w.versions.find((v) => v.status === "draft");
              const published = w.versions.find((v) => v.version === w.currentVersion);
              return (
                <Card key={w.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm">{w.name}</CardTitle>
                      <Switch
                        checked={w.status === "active"}
                        disabled={isPending}
                        onCheckedChange={(v) => {
                          void mutate(
                            () => updateWorkflow(w.id, { status: v ? "active" : "paused" }),
                            v ? "Workflow activated" : "Workflow paused",
                          );
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
                      <div className="pt-0.5 font-medium">{workflowTriggerLabel(w.trigger)}</div>
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
                            void mutate(() => duplicateWorkflow(w.id), "Workflow duplicated");
                          }}
                          aria-label="Duplicate workflow"
                        >
                          <Copy className="size-4" />
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to="/automations/workflows/$workflowId"
                            params={{ workflowId: w.id }}
                          >
                            Edit steps
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(w)}
                          aria-label="Delete workflow"
                        >
                          <Trash2 className="size-4" />
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
                  Add or reorder steps, change delays and swap templates here - no developer needs
                  to touch code.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <NewWorkflowDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSave={(input) => void mutate(() => addWorkflow(input), "Workflow draft created")}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(value) => {
          if (!value) setDeleteTarget(null);
        }}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        description="This removes the workflow and all of its versions and steps. Workflows that leads have ever been enrolled in need a second confirmation - pausing is the non-destructive alternative."
        disabled={isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          setDeleteTarget(null);
          deleteWorkflow(target.id)
            .then(() => toast.success("Workflow deleted"))
            .catch((failure: unknown) => {
              if (
                failure instanceof BackendError &&
                (failure.details as { reason?: string } | undefined)?.reason ===
                  "has_enrollment_history"
              ) {
                setForceDeleteTarget(target);
                return;
              }
              toast.error(messageFromError(failure));
            });
        }}
      />
      <ConfirmDialog
        open={!!forceDeleteTarget}
        onOpenChange={(value) => {
          if (!value) setForceDeleteTarget(null);
        }}
        title={`Force delete "${forceDeleteTarget?.name ?? ""}"?`}
        description="Leads have been enrolled in this workflow. Force-deleting permanently erases that enrollment history (which runs, when, what happened) - this cannot be undone. Pausing the workflow is the reversible alternative."
        confirmLabel="Force delete"
        disabled={isPending}
        onConfirm={() => {
          if (!forceDeleteTarget) return;
          const target = forceDeleteTarget;
          setForceDeleteTarget(null);
          void mutate(
            () => deleteWorkflow(target.id, true),
            "Workflow and its enrollment history deleted",
          );
        }}
      />
    </div>
  );
}

function NewWorkflowDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSave: (input: {
    name: string;
    description?: string | undefined;
    trigger: WorkflowTrigger;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<WorkflowTrigger>("manual_enrollment");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Description</Label>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Trigger</Label>
            <Select value={trigger} onValueChange={(value) => setTrigger(value as WorkflowTrigger)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_TRIGGERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {workflowTriggerLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              onSave({ name: name.trim(), description: description.trim() || undefined, trigger });
              onOpenChange(false);
              setName("");
              setDescription("");
            }}
          >
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
