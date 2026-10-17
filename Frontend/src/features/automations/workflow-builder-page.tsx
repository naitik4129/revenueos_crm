import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUp,
  Check,
  Clock,
  ListChecks,
  Mail,
  MessageCircle,
  OctagonX,
  Pencil,
  Phone,
  Plus,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { relDay } from "@/lib/format";
import { label, workflowTriggerLabel } from "@/lib/labels";
import { BackendError } from "@/lib/backend-client";
import { messageFromError, useAutomations, useSession } from "@/store";
import { stepsWithCumulativeDay } from "@/lib/workflow-timeline";
import { cn } from "@/lib/utils";
import {
  PIPELINE_STAGES,
  STEP_ACTIONS,
  WORKFLOW_TRIGGERS,
  type StepAction,
  type Workflow,
  type WorkflowStep,
  type WorkflowTrigger,
} from "@/types";

export function WorkflowBuilderPage({ workflowId }: { workflowId: string }) {
  const store = useAutomations();
  if (store.isLoading)
    return (
      <div className="p-6">
        <LoadingBlock label="Loading workflow…" />
      </div>
    );
  if (store.error)
    return (
      <div className="p-6">
        <ErrorBlock error={store.error} />
      </div>
    );
  const workflow = store.workflows.find((item) => item.id === workflowId);
  if (!workflow)
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Workflow not found.{" "}
        <Link to="/automations" className="underline">
          Back to automations
        </Link>
      </div>
    );
  return <Builder workflow={workflow} />;
}

interface StepSaveSnapshot {
  workflowId: string;
  versionNumber: number;
  steps: WorkflowStep[];
}

function Builder({ workflow }: { workflow: Workflow }) {
  const store = useAutomations();
  const { userName } = useSession();
  const navigate = useNavigate();
  const [selectedVersion, setSelectedVersion] = useState<number>(
    workflow.currentVersion || workflow.versions.at(-1)?.version || 1,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteWorkflowOpen, setDeleteWorkflowOpen] = useState(false);
  const [forceDeleteWorkflowOpen, setForceDeleteWorkflowOpen] = useState(false);
  const [detailsEditing, setDetailsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(workflow.name);
  const [descriptionDraft, setDescriptionDraft] = useState(workflow.description);
  const version =
    workflow.versions.find((item) => item.version === selectedVersion) ?? workflow.versions.at(-1)!;
  const editable = version.status === "draft";
  const isOnlyVersion = workflow.versions.length <= 1;
  const bufferKey = `${workflow.id}:${version.version}`;
  const [buffer, setBuffer] = useState<{ key: string; steps: WorkflowStep[]; dirty: boolean }>({
    key: bufferKey,
    steps: version.steps,
    dirty: false,
  });
  const [dayDrafts, setDayDrafts] = useState<Record<string, string>>({});
  const steps = buffer.key === bufferKey ? buffer.steps : version.steps;
  const dayByStepId = useMemo(
    () => new Map(stepsWithCumulativeDay(steps).map(({ step, day }) => [step.id, day])),
    [steps],
  );

  useEffect(() => {
    if (buffer.key !== bufferKey) {
      setBuffer({ key: bufferKey, steps: version.steps, dirty: false });
      setDayDrafts({});
    }
  }, [buffer.key, bufferKey, version.steps]);

  useEffect(() => {
    if (detailsEditing) return;
    setNameDraft(workflow.name);
    setDescriptionDraft(workflow.description);
  }, [detailsEditing, workflow.description, workflow.name]);

  // Serialized save queue: a plain promise chain acts as a mutex so at most
  // one PUT .../steps request is ever in flight for this draft at a time.
  // Every step edit (wait/day, toggle, move, add, insert, delete, action or
  // template select) used to call store.updateDraftSteps directly — nearly
  // all of them immediately, wait-days on a 500ms debounce — so a debounced
  // save landing near an immediate one fired two overlapping requests. Each
  // does its own delete-all-then-insert-all, and the second would race the
  // first's commit and raise "duplicate key value violates unique constraint
  // workflow_steps_unique_order". Routing every save through enqueueSave
  // below means a save requested while one is in flight simply waits its
  // turn on the chain, and if a newer edit supersedes it before its turn
  // comes up, the stale one is skipped in favor of the latest — nothing
  // overlaps, and no edit is ever silently dropped.
  const storeRef = useRef(store);
  storeRef.current = store;
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Keyed by "<workflowId>:<versionNumber>" so superseding only ever compares
  // a snapshot against a later edit for that *same* version — a save queued
  // for one draft version must never be skipped just because the user
  // switched to another version and edited that one too.
  const latestSnapshotByKeyRef = useRef(new Map<string, StepSaveSnapshot>());
  const skipNextDebounceRef = useRef(false);

  const enqueueSave = (snapshot: StepSaveSnapshot): Promise<void> => {
    const key = `${snapshot.workflowId}:${snapshot.versionNumber}`;
    latestSnapshotByKeyRef.current.set(key, snapshot);
    const chained = saveQueueRef.current.then(async () => {
      if (latestSnapshotByKeyRef.current.get(key) !== snapshot) return; // superseded while waiting its turn
      try {
        await storeRef.current.updateDraftSteps(
          snapshot.workflowId,
          snapshot.versionNumber,
          snapshot.steps,
        );
      } catch (error) {
        toast.error(messageFromError(error));
        return;
      }
      setBuffer((current) =>
        current.key === key && latestSnapshotByKeyRef.current.get(key) === snapshot
          ? { ...current, dirty: false }
          : current,
      );
    });
    saveQueueRef.current = chained;
    return chained;
  };

  useEffect(() => {
    if (!editable || buffer.key !== bufferKey || !buffer.dirty) return;
    if (skipNextDebounceRef.current) {
      skipNextDebounceRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void enqueueSave({
        workflowId: workflow.id,
        versionNumber: version.version,
        steps: buffer.steps,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [editable, buffer, bufferKey, version.version, workflow.id]);

  // The debounce cleanup above cancels the pending save on *every*
  // dependency change, including on unmount (navigating away). Without this
  // separate mount-only effect, a dirty edit made within the last 500ms
  // before navigating away is silently discarded — never saved, no warning.
  // Refs (kept current every render) let this true-unmount-only cleanup see
  // the latest buffer, flushing any still-dirty edit through the same
  // serialized queue instead of dropping it.
  const flushOnUnmountRef = useRef({
    buffer,
    editable,
    bufferKey,
    workflowId: workflow.id,
    versionNumber: version.version,
  });
  flushOnUnmountRef.current = {
    buffer,
    editable,
    bufferKey,
    workflowId: workflow.id,
    versionNumber: version.version,
  };
  useEffect(() => {
    return () => {
      const current = flushOnUnmountRef.current;
      if (current.editable && current.buffer.dirty && current.buffer.key === current.bufferKey) {
        void enqueueSave({
          workflowId: current.workflowId,
          versionNumber: current.versionNumber,
          steps: current.buffer.steps,
        });
      }
    };
  }, []);

  const setSteps = (next: WorkflowStep[], immediate = false) => {
    const normalized = next.map((step, order) => ({ ...step, order }));
    if (immediate) skipNextDebounceRef.current = true;
    setBuffer({ key: bufferKey, steps: normalized, dirty: true });
    if (immediate) {
      void enqueueSave({
        workflowId: workflow.id,
        versionNumber: version.version,
        steps: normalized,
      });
    }
  };
  const updateStep = (id: string, patch: Partial<WorkflowStep>, immediate = false) =>
    setSteps(
      steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
      immediate,
    );
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = steps.slice();
    [next[index], next[target]] = [next[target]!, next[index]!];
    setSteps(next, true);
  };
  const defaultStep = (): WorkflowStep => ({
    id: crypto.randomUUID(),
    order: 0,
    delayDays: 2,
    action: "send_email",
    templateId: store.templates.find((template) => template.type === "email" && template.active)
      ?.id,
    enabled: true,
  });
  const addStep = () => setSteps([...steps, defaultStep()], true);
  const insertStepAt = (index: number) => {
    const next = steps.slice();
    next.splice(index, 0, defaultStep());
    setSteps(next, true);
  };
  const commitDay = (step: WorkflowStep, index: number, rawValue: string) => {
    setDayDrafts((current) => {
      const next = { ...current };
      delete next[step.id];
      return next;
    });
    const parsed = Number(rawValue);
    const typedDay = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
    const prevDay = index === 0 ? 0 : (dayByStepId.get(steps[index - 1]!.id) ?? 0);
    const delayDays = Math.max(0, typedDay - prevDay);
    if (delayDays !== step.delayDays) updateStep(step.id, { delayDays }, true);
  };
  const mutate = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      toast.success(success);
    } catch (error) {
      toast.error(messageFromError(error));
    }
  };
  const createDraft = () =>
    void mutate(async () => {
      const number = await store.createDraft(workflow.id);
      setSelectedVersion(number);
    }, "Draft ready to edit");
  const publish = () =>
    void mutate(async () => {
      await enqueueSave({ workflowId: workflow.id, versionNumber: version.version, steps });
      await store.publishVersion(workflow.id, version.version);
      setPublishOpen(false);
    }, `V${version.version} published`);
  const discardDraft = () =>
    void mutate(async () => {
      setDiscardOpen(false);
      const updated = await store.deleteWorkflowVersion(workflow.id, version.version);
      const next =
        updated.versions.find((item) => item.status === "published") ?? updated.versions.at(-1);
      if (next) setSelectedVersion(next.version);
    }, "Draft discarded");
  const deleteWorkflow = () => {
    setDeleteWorkflowOpen(false);
    store
      .deleteWorkflow(workflow.id)
      .then(() => {
        toast.success("Workflow deleted");
        void navigate({ to: "/automations" });
      })
      .catch((error: unknown) => {
        if (
          error instanceof BackendError &&
          (error.details as { reason?: string } | undefined)?.reason === "has_enrollment_history"
        ) {
          setForceDeleteWorkflowOpen(true);
          return;
        }
        toast.error(messageFromError(error));
      });
  };
  const forceDeleteWorkflow = () =>
    void mutate(async () => {
      setForceDeleteWorkflowOpen(false);
      await store.deleteWorkflow(workflow.id, true);
      void navigate({ to: "/automations" });
    }, "Workflow and its enrollment history deleted");
  const startDetailsEdit = () => {
    setNameDraft(workflow.name);
    setDescriptionDraft(workflow.description);
    setDetailsEditing(true);
  };
  const cancelDetailsEdit = () => {
    setNameDraft(workflow.name);
    setDescriptionDraft(workflow.description);
    setDetailsEditing(false);
  };
  const saveDetails = () => {
    const nextName = nameDraft.trim();
    const nextDescription = descriptionDraft.trim();
    if (!nextName) {
      toast.error("Workflow name is required.");
      return;
    }
    store
      .updateWorkflow(workflow.id, { name: nextName, description: nextDescription })
      .then(() => {
        toast.success("Workflow details updated");
        setDetailsEditing(false);
      })
      .catch((error: unknown) => {
        toast.error(messageFromError(error));
      });
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={workflow.name}
        heading={
          <WorkflowDetailsHeading
            name={workflow.name}
            description={workflow.description}
            editing={detailsEditing}
            nameDraft={nameDraft}
            descriptionDraft={descriptionDraft}
            disabled={store.isPending}
            onEdit={startDetailsEdit}
            onCancel={cancelDetailsEdit}
            onSave={saveDetails}
            onNameChange={setNameDraft}
            onDescriptionChange={setDescriptionDraft}
          />
        }
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link to="/automations">
                <ArrowLeft className="mr-1 size-4" /> Automations
              </Link>
            </Button>
            {editable ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() =>
                    isOnlyVersion ? setDeleteWorkflowOpen(true) : setDiscardOpen(true)
                  }
                >
                  {isOnlyVersion ? "Delete workflow" : "Discard draft"}
                </Button>
                <Button size="sm" onClick={() => setPublishOpen(true)}>
                  Publish V{version.version}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={createDraft}>
                Edit as new draft
              </Button>
            )}
          </>
        }
      />
      <VersionBanner
        version={version.version}
        status={version.status}
        live={version.version === workflow.currentVersion}
        saving={editable && buffer.key === bufferKey && buffer.dirty}
      />
      <div className="grid gap-4 px-6 pb-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Starts when</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
                <Zap className="size-4" />
              </div>
              <Select
                value={workflow.trigger}
                disabled={store.isPending}
                onValueChange={(value) =>
                  void mutate(
                    () => store.updateWorkflow(workflow.id, { trigger: value as WorkflowTrigger }),
                    "Trigger updated",
                  )
                }
              >
                <SelectTrigger className="w-72">
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
              <span className="text-xs text-muted-foreground">
                Future matching leads enter this workflow.
              </span>
            </CardContent>
          </Card>
          {steps.map((step, index) => {
            const Icon = ACTION_ICON[step.action];
            return (
              <div key={step.id}>
                <StepConnector
                  first={index === 0}
                  delayDays={step.delayDays}
                  {...(editable
                    ? {
                        insertLabel: `Insert step before step ${index + 1}`,
                        onInsert: () => insertStepAt(index),
                      }
                    : {})}
                />
                <Card className={cn("overflow-hidden", !step.enabled && "opacity-60")}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-background text-xs font-semibold">
                        {index + 1}
                      </span>
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-md",
                          ACTION_TONE[step.action],
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="text-sm font-medium">{label(step.action)}</span>
                      {["send_email", "send_whatsapp"].includes(step.action) && (
                        <StatusBadge
                          value={
                            step.templateId ? store.templateName(step.templateId) : "No template"
                          }
                          tone={step.templateId ? "muted" : "danger"}
                        />
                      )}
                      <span className="text-xs text-muted-foreground">
                        Day {dayByStepId.get(step.id) ?? 0}
                      </span>
                      {!step.enabled && <StatusBadge value="Skipped" tone="muted" />}
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={step.enabled}
                        disabled={!editable}
                        aria-label={`Step ${index + 1} enabled`}
                        onCheckedChange={(value) => updateStep(step.id, { enabled: value }, true)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Move step ${index + 1} up`}
                        disabled={!editable || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Move step ${index + 1} down`}
                        disabled={!editable || index === steps.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete step ${index + 1}`}
                        disabled={!editable}
                        onClick={() =>
                          setSteps(
                            steps.filter((item) => item.id !== step.id),
                            true,
                          )
                        }
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <CardContent className="grid gap-3 py-4 md:grid-cols-3">
                    <div>
                      <Label className="mb-1.5 block text-xs">Day (from enrollment)</Label>
                      <Input
                        type="number"
                        min={0}
                        disabled={!editable}
                        value={dayDrafts[step.id] ?? String(dayByStepId.get(step.id) ?? 0)}
                        onChange={(event) =>
                          setDayDrafts((current) => ({ ...current, [step.id]: event.target.value }))
                        }
                        onBlur={(event) => commitDay(step, index, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </div>
                    <div>
                      <Label className="mb-1.5 block text-xs">Action</Label>
                      <Select
                        value={step.action}
                        disabled={!editable}
                        onValueChange={(value) => {
                          const action = value as StepAction;
                          const template =
                            action === "send_email"
                              ? store.templates.find((item) => item.type === "email" && item.active)
                                  ?.id
                              : action === "send_whatsapp"
                                ? store.templates.find(
                                    (item) => item.type === "whatsapp" && item.active,
                                  )?.id
                                : undefined;
                          updateStep(step.id, { action, templateId: template }, true);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STEP_ACTIONS.map((value) => (
                            <SelectItem key={value} value={value}>
                              {label(value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <StepConfig
                      step={step}
                      editable={editable}
                      templates={store.templates}
                      onChange={(patch, immediate) => updateStep(step.id, patch, immediate)}
                    />
                  </CardContent>
                </Card>
              </div>
            );
          })}
          <div className="mx-auto h-4 w-px bg-border" />
          {editable ? (
            <Button variant="outline" className="w-full border-dashed" onClick={addStep}>
              <Plus className="mr-1 size-4" /> Add step
            </Button>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Published versions are read-only. Create a draft to change the sequence.
            </p>
          )}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Versions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {workflow.versions
                .slice()
                .sort((a, b) => b.version - a.version)
                .map((item) => (
                  <button
                    key={item.version}
                    onClick={() => setSelectedVersion(item.version)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent/40 ${item.version === version.version ? "border-primary bg-primary/5" : ""}`}
                  >
                    <span>
                      V{item.version}
                      <span className="block text-xs text-muted-foreground">
                        {item.createdBy} · {relDay(item.createdAt)}
                      </span>
                    </span>
                    <StatusBadge value={item.status} />
                  </button>
                ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Row label="Status" value={label(workflow.status)} />
              <Row label="Owner" value={userName(workflow.ownerId)} />
              <Row label="Active leads" value={String(workflow.activeLeads)} />
              <Row label="Steps" value={String(steps.length)} />
              <Row label="Updated" value={relDay(workflow.updatedAt)} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-xs text-muted-foreground">
              Draft edits are saved to the backend. Publishing never migrates existing runs.
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish V{version.version}</DialogTitle>
            <DialogDescription>
              Existing runs keep their current version; new enrollments use this version.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border px-3 py-2 text-sm">
            Let current runs finish on the version they started with.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                store.isPending ||
                steps.length === 0 ||
                steps.some(
                  (step) =>
                    ["send_email", "send_whatsapp"].includes(step.action) && !step.templateId,
                )
              }
              onClick={publish}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={`Discard draft V${version.version}?`}
        description="This permanently deletes this draft's steps. The workflow's published version is unaffected."
        confirmLabel="Discard draft"
        disabled={store.isPending}
        onConfirm={discardDraft}
      />
      <ConfirmDialog
        open={deleteWorkflowOpen}
        onOpenChange={setDeleteWorkflowOpen}
        title={`Delete "${workflow.name}"?`}
        description="This removes the workflow and all of its versions and steps. Workflows that leads have ever been enrolled in need a second confirmation - pausing is the non-destructive alternative."
        disabled={store.isPending}
        onConfirm={deleteWorkflow}
      />
      <ConfirmDialog
        open={forceDeleteWorkflowOpen}
        onOpenChange={setForceDeleteWorkflowOpen}
        title={`Force delete "${workflow.name}"?`}
        description="Leads have been enrolled in this workflow. Force-deleting permanently erases that enrollment history (which runs, when, what happened) - this cannot be undone. Pausing the workflow is the reversible alternative."
        confirmLabel="Force delete"
        disabled={store.isPending}
        onConfirm={forceDeleteWorkflow}
      />
    </div>
  );
}

const ACTION_ICON: Record<StepAction, LucideIcon> = {
  send_email: Mail,
  send_whatsapp: MessageCircle,
  create_call_task: Phone,
  create_follow_up_task: ListChecks,
  change_lead_stage: ArrowRightLeft,
  stop_workflow: OctagonX,
};
const ACTION_TONE: Record<StepAction, string> = {
  send_email: "bg-info/10 text-info",
  send_whatsapp: "bg-success/10 text-success",
  create_call_task: "bg-primary/10 text-primary",
  create_follow_up_task: "bg-primary/10 text-primary",
  change_lead_stage: "bg-warning/15 text-warning-foreground",
  stop_workflow: "bg-destructive/10 text-destructive",
};

/** "Wait 2 days" between two steps, with the insert button when the draft is editable. */
function StepConnector({
  first,
  delayDays,
  insertLabel,
  onInsert,
}: {
  first: boolean;
  delayDays: number;
  insertLabel?: string;
  onInsert?: () => void;
}) {
  const wait =
    delayDays === 0
      ? first
        ? "Right after enrollment"
        : "Straight after the previous step"
      : `Wait ${delayDays} day${delayDays === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-col items-center py-1">
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
        <Clock className="size-3" /> {wait}
        {onInsert && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="-mr-1.5 size-5 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={insertLabel}
            title="Add a step here"
            onClick={onInsert}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="h-3 w-px bg-border" />
    </div>
  );
}

/** Which version is on screen and whether it is live, a draft (autosaving) or an old one. */
function VersionBanner({
  version,
  status,
  live,
  saving,
}: {
  version: number;
  status: "draft" | "published" | "previous";
  live: boolean;
  saving: boolean;
}) {
  const [tone, text] =
    status === "draft"
      ? [
          "border-warning/40 bg-warning/10",
          `Draft V${version} is not live. Edits save automatically; publish to use them for new enrollments.`,
        ]
      : live
        ? [
            "border-success/40 bg-success/10",
            `V${version} is live. Published versions are read-only; edit as a new draft to change it.`,
          ]
        : ["bg-muted", `V${version} is an older version (read-only).`];
  return (
    <div className="px-6 py-3">
      <div
        role="status"
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm",
          tone,
        )}
      >
        <StatusBadge value={status === "draft" ? "Draft" : live ? "Live" : "Previous"} />
        <span className="min-w-0 flex-1">{text}</span>
        {status === "draft" && (
          <span className="text-xs text-muted-foreground">
            {saving ? "Saving…" : "All changes saved"}
          </span>
        )}
      </div>
    </div>
  );
}

function WorkflowDetailsHeading({
  name,
  description,
  editing,
  nameDraft,
  descriptionDraft,
  disabled,
  onEdit,
  onCancel,
  onSave,
  onNameChange,
  onDescriptionChange,
}: {
  name: string;
  description: string;
  editing: boolean;
  nameDraft: string;
  descriptionDraft: string;
  disabled: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  if (!editing) {
    return (
      <div className="flex max-w-2xl items-start gap-2">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold tracking-tight">{name}</h1>
          {description && (
            <p className="mt-0.5 break-words text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="mt-0.5 size-8 shrink-0 text-muted-foreground"
          disabled={disabled}
          aria-label="Edit workflow details"
          onClick={onEdit}
        >
          <Pencil className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid w-full max-w-xl gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <Input
        value={nameDraft}
        disabled={disabled}
        aria-label="Workflow name"
        className="h-9 text-xl font-semibold"
        autoFocus
        onChange={(event) => onNameChange(event.target.value)}
      />
      <Textarea
        value={descriptionDraft}
        disabled={disabled}
        aria-label="Workflow description"
        className="min-h-16 resize-none text-sm"
        onChange={(event) => onDescriptionChange(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={disabled || !nameDraft.trim()}>
          <Check className="mr-1 size-4" /> Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>
          <X className="mr-1 size-4" /> Cancel
        </Button>
      </div>
    </form>
  );
}

function StepConfig({
  step,
  editable,
  templates,
  onChange,
}: {
  step: WorkflowStep;
  editable: boolean;
  templates: ReturnType<typeof useAutomations>["templates"];
  onChange: (patch: Partial<WorkflowStep>, immediate?: boolean) => void;
}) {
  if (step.action === "send_email" || step.action === "send_whatsapp")
    return (
      <div>
        <Label className="mb-1.5 block text-xs">Template</Label>
        <Select
          value={step.templateId ?? ""}
          disabled={!editable}
          onValueChange={(value) => onChange({ templateId: value }, true)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose template" />
          </SelectTrigger>
          <SelectContent>
            {templates
              .filter(
                (template) =>
                  template.type === (step.action === "send_email" ? "email" : "whatsapp"),
              )
              .map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    );
  if (step.action === "change_lead_stage")
    return (
      <div>
        <Label className="mb-1.5 block text-xs">Target stage</Label>
        <Select
          value={step.config ?? ""}
          disabled={!editable}
          onValueChange={(value) => onChange({ config: value }, true)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose stage" />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_STAGES.map((value) => (
              <SelectItem key={value} value={value}>
                {label(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  return (
    <div>
      <Label className="mb-1.5 block text-xs">
        {step.action === "stop_workflow" ? "Note" : "Task title"}
      </Label>
      <Input
        disabled={!editable}
        value={step.config ?? ""}
        onChange={(event) => onChange({ config: event.target.value })}
      />
    </div>
  );
}
function Row({ label: name, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{name}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
