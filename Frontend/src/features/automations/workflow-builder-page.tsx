import { useState } from "react";
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
import { relDay } from "@/lib/format";
import { useAutomations, useSession } from "@/store";
import {
  PIPELINE_STAGES,
  STEP_ACTIONS,
  WORKFLOW_TRIGGERS,
  type StepAction,
  type WorkflowStep,
  type WorkflowTrigger,
} from "@/types";

export function WorkflowBuilderPage({ workflowId }: { workflowId: string }) {
  const {
    workflows,
    templates,
    updateWorkflow,
    updateDraftSteps,
    createDraft,
    publishVersion,
    templateName,
  } = useAutomations();
  const { userName } = useSession();

  const wf = workflows.find((w) => w.id === workflowId);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [enrollmentMode, setEnrollmentMode] = useState("continue");

  if (!wf) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Workflow not found.{" "}
        <Link to="/automations" className="underline">
          Back to automations
        </Link>
      </div>
    );
  }

  const version =
    wf.versions.find((v) => v.version === (selectedVersion ?? wf.currentVersion)) ??
    wf.versions[0]!;
  const editable = version.status === "Draft";
  const steps = version.steps;

  const setSteps = (next: WorkflowStep[]) => updateDraftSteps(wf.id, version.version, next);

  const updateStep = (id: string, patch: Partial<WorkflowStep>) =>
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = steps.slice();
    const a = next[index]!;
    next[index] = next[target]!;
    next[target] = a;
    setSteps(next);
  };

  const addStep = () =>
    setSteps([
      ...steps,
      {
        id: `s${Date.now()}`,
        delayDays: 2,
        action: "Send Email",
        templateId: templates[0]?.id,
        enabled: true,
      },
    ]);

  return (
    <div className="pb-10">
      <PageHeader
        title={wf.name}
        description={wf.description}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link to="/automations">
                <ArrowLeft className="mr-1 size-4" /> Automations
              </Link>
            </Button>
            {!editable ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const v = createDraft(wf.id);
                  setSelectedVersion(v);
                  toast.success(`Draft V${v} ready to edit`);
                }}
              >
                Edit as new draft
              </Button>
            ) : (
              <Button size="sm" onClick={() => setPublishOpen(true)}>
                Publish V{version.version}
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
                value={wf.trigger}
                onValueChange={(v) => {
                  updateWorkflow(wf.id, { trigger: v as WorkflowTrigger });
                  toast.success("Trigger updated");
                }}
              >
                <SelectTrigger className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_TRIGGERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Leads enter the workflow when this happens.
              </span>
            </CardContent>
          </Card>

          {steps.map((s, i) => (
            <Card key={s.id} className={s.enabled ? "" : "opacity-60"}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="num grid size-6 place-items-center rounded-full bg-secondary text-xs font-semibold">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium">{s.action}</span>
                    {(s.action === "Send Email" || s.action === "Send WhatsApp") && (
                      <StatusBadge value={templateName(s.templateId)} tone="muted" />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch
                      checked={s.enabled}
                      disabled={!editable}
                      onCheckedChange={(v) => updateStep(s.id, { enabled: v })}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!editable || i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="Move step up"
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!editable || i === steps.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move step down"
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!editable}
                      onClick={() => setSteps(steps.filter((x) => x.id !== s.id))}
                      aria-label="Delete step"
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
                      value={s.delayDays}
                      onChange={(e) => updateStep(s.id, { delayDays: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs">Action</Label>
                    <Select
                      value={s.action}
                      disabled={!editable}
                      onValueChange={(v) => updateStep(s.id, { action: v as StepAction })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STEP_ACTIONS.map((a) => (
                          <SelectItem key={a} value={a}>
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    {s.action === "Send Email" || s.action === "Send WhatsApp" ? (
                      <>
                        <Label className="mb-1.5 block text-xs">Template</Label>
                        <Select
                          value={s.templateId ?? ""}
                          disabled={!editable}
                          onValueChange={(v) => updateStep(s.id, { templateId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose template" />
                          </SelectTrigger>
                          <SelectContent>
                            {templates
                              .filter((t) =>
                                s.action === "Send Email"
                                  ? t.type === "Email"
                                  : t.type === "WhatsApp",
                              )
                              .map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </>
                    ) : s.action === "Change Lead Stage" ? (
                      <>
                        <Label className="mb-1.5 block text-xs">Target stage</Label>
                        <Select
                          value={s.config ?? ""}
                          disabled={!editable}
                          onValueChange={(v) => updateStep(s.id, { config: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose stage" />
                          </SelectTrigger>
                          <SelectContent>
                            {PIPELINE_STAGES.map((st) => (
                              <SelectItem key={st} value={st}>
                                {st}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    ) : s.action === "Stop Workflow" ? (
                      <>
                        <Label className="mb-1.5 block text-xs">Note</Label>
                        <Input
                          disabled={!editable}
                          value={s.config ?? ""}
                          onChange={(e) => updateStep(s.id, { config: e.target.value })}
                          placeholder="End of sequence"
                        />
                      </>
                    ) : (
                      <>
                        <Label className="mb-1.5 block text-xs">Task title</Label>
                        <Input
                          disabled={!editable}
                          value={s.config ?? ""}
                          onChange={(e) => updateStep(s.id, { config: e.target.value })}
                          placeholder="Call the lead again"
                        />
                      </>
                    )}
                  </div>
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
              {wf.versions
                .slice()
                .sort((a, b) => b.version - a.version)
                .map((v) => (
                  <button
                    key={v.version}
                    onClick={() => setSelectedVersion(v.version)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent/40 ${
                      v.version === version.version ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <span>
                      V{v.version}
                      <span className="block text-xs text-muted-foreground">
                        {v.createdBy} · {relDay(v.createdAt)}
                      </span>
                    </span>
                    <StatusBadge value={v.status} />
                  </button>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Status" value={wf.status} />
              <Row label="Owner" value={userName(wf.ownerId)} />
              <Row label="Active leads" value={String(wf.activeLeads)} />
              <Row label="Steps" value={String(steps.length)} />
              <Row label="Updated" value={relDay(wf.updatedAt)} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4 text-xs text-muted-foreground">
              Publishing writes the new sequence to Supabase; n8n reads it on the next scheduled
              run.
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish V{version.version}</DialogTitle>
            <DialogDescription>
              Choose what happens to the {wf.activeLeads} leads currently in this workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {[
              ["continue", "Let them finish on the current version"],
              ["migrate", "Move them to the same step on the new version"],
              ["restart", "Restart them from step 1"],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setEnrollmentMode(v!)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent/40 ${
                  enrollmentMode === v ? "border-primary bg-primary/5" : ""
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                publishVersion(wf.id, version.version);
                setPublishOpen(false);
                setSelectedVersion(version.version);
                toast.success(`V${version.version} published`);
              }}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
