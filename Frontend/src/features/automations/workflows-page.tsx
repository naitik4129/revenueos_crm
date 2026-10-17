import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, Copy, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/common/status-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import {
  ListEmptyState,
  RecordTable,
  ViewTabs,
  type ListColumn,
} from "@/components/common/list-controls";
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

  const [status, setStatus] = useState<"all" | "active" | "paused">("all");
  const filteredWorkflows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return workflows.filter(
      (w) =>
        (status === "all" || w.status === status) &&
        (!query ||
          `${w.name} ${w.description ?? ""} ${workflowTriggerLabel(w.trigger)}`
            .toLowerCase()
            .includes(query)),
    );
  }, [workflows, q, status]);
  const count = (s: "active" | "paused") => workflows.filter((w) => w.status === s).length;

  const columns: ListColumn<Workflow>[] = [
    {
      id: "status",
      label: "Status",
      cell: (w) => (
        <span className="flex items-center gap-2">
          <Switch
            checked={w.status === "active"}
            disabled={isPending}
            aria-label={`${w.status === "active" ? "Pause" : "Activate"} ${w.name}`}
            onCheckedChange={(v) => {
              void mutate(
                () => updateWorkflow(w.id, { status: v ? "active" : "paused" }),
                v ? "Workflow activated" : "Workflow paused",
              );
            }}
          />
          <StatusBadge value={w.status} dot />
        </span>
      ),
    },
    { id: "trigger", label: "Trigger", cell: (w) => workflowTriggerLabel(w.trigger) },
    {
      id: "version",
      label: "Version",
      cell: (w) => {
        const draft = w.versions.find((v) => v.status === "draft");
        return (
          <span className="flex items-center gap-1">
            {w.currentVersion > 0 ? (
              <StatusBadge value={`V${w.currentVersion} live`} tone="success" />
            ) : (
              <StatusBadge value="Not published" tone="muted" />
            )}
            {draft && <StatusBadge value={`V${draft.version} draft`} tone="warning" />}
          </span>
        );
      },
    },
    {
      id: "steps",
      label: "Steps",
      cell: (w) => w.versions.find((v) => v.version === w.currentVersion)?.steps.length ?? 0,
    },
    { id: "runs", label: "Active runs", cell: (w) => w.activeLeads },
    {
      id: "failures",
      label: "Failures",
      cell: (w) => (w.failures > 0 ? <span className="text-destructive">{w.failures}</span> : 0),
    },
    {
      id: "edited",
      label: "Last edited",
      cell: (w) => `${relDay(w.updatedAt)} · ${userName(w.ownerId)}`,
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Automations"
        description="Workflows run on the backend worker. Publishing a version changes live behaviour."
        tabs={<AutomationTabs />}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Create workflow
          </Button>
        }
      />

      <div className="px-6 py-4">
        <Card className="overflow-hidden p-0">
          <div className="border-b px-3">
            <ViewTabs
              views={[
                { id: "all", label: `All (${workflows.length})` },
                { id: "active", label: `Active (${count("active")})` },
                { id: "paused", label: `Paused (${count("paused")})` },
              ]}
              active={status}
              onSelect={(id) => setStatus(id as typeof status)}
            />
          </div>
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search workflows"
                aria-label="Search workflows"
                className="pl-8"
              />
            </div>
          </div>

          {isLoading ? (
            <LoadingBlock label="Loading workflows…" />
          ) : error ? (
            <ErrorBlock error={error} />
          ) : filteredWorkflows.length === 0 ? (
            <ListEmptyState
              icon={Bot}
              title={workflows.length === 0 ? "No workflows yet" : "No workflows match."}
              text="A workflow sends emails and WhatsApps, creates tasks and moves stages on a schedule, with no code."
            >
              {workflows.length === 0 && (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Create your first workflow
                </Button>
              )}
            </ListEmptyState>
          ) : (
            <RecordTable
              rows={filteredWorkflows}
              columns={columns}
              nameHeader="Workflow"
              rowLabel={(w) => w.name}
              name={(w) => (
                <div className="min-w-48 max-w-80">
                  <Link
                    to="/automations/workflows/$workflowId"
                    params={{ workflowId: w.id }}
                    className="font-medium hover:underline"
                  >
                    {w.name}
                  </Link>
                  {w.description && (
                    <div className="truncate text-xs text-muted-foreground">{w.description}</div>
                  )}
                </div>
              )}
              actions={(w) => (
                <span className="flex justify-end gap-1">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/automations/workflows/$workflowId" params={{ workflowId: w.id }}>
                      Edit steps
                    </Link>
                  </Button>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleteTarget(w)}
                    aria-label="Delete workflow"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              )}
            />
          )}
        </Card>
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
          <DialogTitle>Create workflow</DialogTitle>
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
