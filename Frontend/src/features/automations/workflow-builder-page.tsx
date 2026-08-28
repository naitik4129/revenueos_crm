import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2, Zap } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { messageFromError, useAutomations, useSession } from "@/store";
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

function Builder({ workflow }: { workflow: Workflow }) {
  const store = useAutomations();
  const { userName } = useSession();
  const [selectedVersion, setSelectedVersion] = useState<number>(
    workflow.currentVersion || workflow.versions.at(-1)?.version || 1,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const version =
    workflow.versions.find((item) => item.version === selectedVersion) ?? workflow.versions.at(-1)!;
  const editable = version.status === "draft";
  const bufferKey = `${workflow.id}:${version.version}`;
  const [buffer, setBuffer] = useState<{ key: string; steps: WorkflowStep[]; dirty: boolean }>({
    key: bufferKey,
    steps: version.steps,
    dirty: false,
  });
  const steps = buffer.key === bufferKey ? buffer.steps : version.steps;

  useEffect(() => {
    if (buffer.key !== bufferKey) setBuffer({ key: bufferKey, steps: version.steps, dirty: false });
  }, [buffer.key, bufferKey, version.steps]);
  useEffect(() => {
    if (!editable || buffer.key !== bufferKey || !buffer.dirty) return;
    const timer = window.setTimeout(() => {
      void store
        .updateDraftSteps(workflow.id, version.version, buffer.steps)
        .then(() =>
          setBuffer((current) =>
            current.key === bufferKey ? { ...current, dirty: false } : current,
          ),
        )
        .catch((error) => toast.error(messageFromError(error)));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [editable, buffer, bufferKey, store, version.version, workflow.id]);

  // The debounce cleanup above cancels the pending save on *every*
  // dependency change, including on unmount (navigating away). Without this
  // separate mount-only effect, a dirty edit made within the last 500ms
  // before navigating away is silently discarded — never saved, no warning.
  // Refs (kept current every render) let this true-unmount-only cleanup see
  // the latest buffer/store, flushing any still-dirty edit instead of
  // dropping it.
  const flushOnUnmountRef = useRef({ buffer, editable, bufferKey, store, workflowId: workflow.id, versionNumber: version.version });
  flushOnUnmountRef.current = { buffer, editable, bufferKey, store, workflowId: workflow.id, versionNumber: version.version };
  useEffect(() => {
    return () => {
      const current = flushOnUnmountRef.current;
      if (current.editable && current.buffer.dirty && current.buffer.key === current.bufferKey) {
        void current.store.updateDraftSteps(current.workflowId, current.versionNumber, current.buffer.steps);
      }
    };
  }, []);

  const setSteps = (next: WorkflowStep[], immediate = false) => {
    const normalized = next.map((step, order) => ({ ...step, order }));
    setBuffer({ key: bufferKey, steps: normalized, dirty: !immediate });
    if (immediate) {
      void store
        .updateDraftSteps(workflow.id, version.version, normalized)
        .catch((error) => toast.error(messageFromError(error)));
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
  const addStep = () =>
    setSteps(
      [
        ...steps,
        {
          id: crypto.randomUUID(),
          order: steps.length,
          delayDays: 2,
          action: "send_email",
          templateId: store.templates.find(
            (template) => template.type === "email" && template.active,
          )?.id,
          enabled: true,
        },
      ],
      true,
    );
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
      await store.updateDraftSteps(workflow.id, version.version, steps);
      await store.publishVersion(workflow.id, version.version);
      setPublishOpen(false);
    }, `V${version.version} published`);

  return (
    <div className="pb-10">
      <PageHeader
        title={workflow.name}
        description={workflow.description}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link to="/automations">
                <ArrowLeft className="mr-1 size-4" /> Automations
              </Link>
            </Button>
            {editable ? (
              <Button size="sm" onClick={() => setPublishOpen(true)}>
                Publish V{version.version}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={createDraft}>
                Edit as new draft
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 p-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Trigger</CardTitle>
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
                      {label(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Future matching leads enter this workflow.
              </span>
            </CardContent>
          </Card>
          {steps.map((step, index) => (
            <Card key={step.id} className={step.enabled ? "" : "opacity-60"}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="num grid size-6 place-items-center rounded-full bg-secondary text-xs font-semibold">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium">{label(step.action)}</span>
                    {["send_email", "send_whatsapp"].includes(step.action) && (
                      <StatusBadge value={store.templateName(step.templateId)} tone="muted" />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch
                      checked={step.enabled}
                      disabled={!editable}
                      onCheckedChange={(value) => updateStep(step.id, { enabled: value }, true)}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!editable || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!editable || index === steps.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
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
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <Label className="mb-1.5 block text-xs">Wait (days)</Label>
                    <Input
                      type="number"
                      min={0}
                      disabled={!editable}
                      value={step.delayDays}
                      onChange={(event) =>
                        updateStep(step.id, { delayDays: Math.max(0, Number(event.target.value)) })
                      }
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
                </div>
              </CardContent>
            </Card>
          ))}
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
    </div>
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
