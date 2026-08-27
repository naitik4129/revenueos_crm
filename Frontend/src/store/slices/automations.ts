import { useCallback, useMemo, useState } from "react";
import * as seed from "@/mocks/seed";
import type { AutomationMode, Run, Template, Workflow, WorkflowStep } from "@/types";
import { createSliceContext } from "../context";
import type { NextId } from "../ids";
import { NOW } from "@/lib/dates";

export interface AutomationsSlice {
  workflows: Workflow[];
  runs: Run[];
  templates: Template[];
  templateName: (id?: string) => string;
  updateWorkflow: (id: string, patch: Partial<Workflow>) => void;
  updateDraftSteps: (workflowId: string, version: number, steps: WorkflowStep[]) => void;
  createDraft: (workflowId: string) => number;
  publishVersion: (workflowId: string, version: number) => void;
  duplicateWorkflow: (workflowId: string) => void;
  updateRun: (id: string, patch: Partial<Run>) => void;
  addTemplate: (template: Omit<Template, "id">) => void;
  updateTemplate: (id: string, patch: Partial<Template>) => void;
}

/**
 * Run mutations driven from the lead side — pausing a lead's automation or
 * marking it Do Not Contact has to stop whatever n8n would execute next.
 */
export interface RunEffects {
  applyAutomationMode: (leadId: string, mode: AutomationMode) => void;
  cancelRunsForLead: (leadId: string, reason: string) => void;
}

export const [AutomationsContext, useAutomations] =
  createSliceContext<AutomationsSlice>("useAutomations");

export function useAutomationsSlice(
  nid: NextId,
  currentUserName: string,
): AutomationsSlice & { runEffects: RunEffects } {
  const [workflows, setWorkflows] = useState<Workflow[]>(seed.workflows);
  const [runs, setRuns] = useState<Run[]>(seed.runs);
  const [templates, setTemplates] = useState<Template[]>(seed.templates);

  const updateRun = useCallback((id: string, patch: Partial<Run>) => {
    setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const applyAutomationMode = useCallback((leadId: string, mode: AutomationMode) => {
    setRuns((prev) =>
      prev.map((r) =>
        r.leadId === leadId &&
        (r.status === "Running" || r.status === "Waiting" || r.status === "Paused")
          ? {
              ...r,
              status: mode === "Paused" ? "Paused" : mode === "Active" ? "Running" : "Cancelled",
            }
          : r,
      ),
    );
  }, []);

  const cancelRunsForLead = useCallback((leadId: string, reason: string) => {
    setRuns((prev) =>
      prev.map((r) =>
        r.leadId === leadId && r.status !== "Completed"
          ? { ...r, status: "Cancelled", lastError: reason }
          : r,
      ),
    );
  }, []);

  const updateWorkflow = useCallback((id: string, patch: Partial<Workflow>) => {
    setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: NOW } : w)));
  }, []);

  const updateDraftSteps = useCallback(
    (workflowId: string, version: number, steps: WorkflowStep[]) => {
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === workflowId
            ? {
                ...w,
                updatedAt: NOW,
                versions: w.versions.map((v) => (v.version === version ? { ...v, steps } : v)),
              }
            : w,
        ),
      );
    },
    [],
  );

  const publishVersion = useCallback((workflowId: string, version: number) => {
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              currentVersion: version,
              updatedAt: NOW,
              versions: w.versions.map((v) =>
                v.version === version
                  ? { ...v, status: "Published" as const, publishedAt: NOW }
                  : v.status === "Published"
                    ? { ...v, status: "Previous" as const }
                    : v,
              ),
            }
          : w,
      ),
    );
  }, []);

  const createDraft = useCallback(
    (workflowId: string) => {
      const wf = workflows.find((w) => w.id === workflowId);
      if (!wf) return 0;
      const existingDraft = wf.versions.find((v) => v.status === "Draft");
      if (existingDraft) return existingDraft.version;

      const next = Math.max(...wf.versions.map((v) => v.version)) + 1;
      const base = wf.versions.find((v) => v.version === wf.currentVersion);
      const steps = (base?.steps ?? []).map((s) => ({ ...s, id: nid("s") }));

      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === workflowId
            ? {
                ...w,
                versions: [
                  ...w.versions,
                  {
                    version: next,
                    status: "Draft" as const,
                    createdBy: currentUserName,
                    createdAt: NOW,
                    steps,
                  },
                ],
              }
            : w,
        ),
      );
      return next;
    },
    [workflows, nid, currentUserName],
  );

  const duplicateWorkflow = useCallback(
    (workflowId: string) => {
      const wf = workflows.find((w) => w.id === workflowId);
      if (!wf) return;
      const current = wf.versions.find((v) => v.version === wf.currentVersion);
      const copy: Workflow = {
        ...wf,
        id: nid("wf"),
        name: `${wf.name} (copy)`,
        status: "Paused",
        currentVersion: 1,
        activeLeads: 0,
        failures: 0,
        updatedAt: NOW,
        versions: [
          {
            version: 1,
            status: "Draft",
            createdBy: currentUserName,
            createdAt: NOW,
            steps: (current?.steps ?? []).map((s) => ({ ...s, id: nid("s") })),
          },
        ],
      };
      setWorkflows((prev) => [...prev, copy]);
    },
    [workflows, nid, currentUserName],
  );

  const addTemplate = useCallback(
    (template: Omit<Template, "id">) => {
      const created: Template = { ...template, id: nid("tp") };
      setTemplates((prev) => [...prev, created]);
    },
    [nid],
  );

  const updateTemplate = useCallback((id: string, patch: Partial<Template>) => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const runEffects = useMemo<RunEffects>(
    () => ({ applyAutomationMode, cancelRunsForLead }),
    [applyAutomationMode, cancelRunsForLead],
  );

  return useMemo(
    () => ({
      workflows,
      runs,
      templates,
      templateName: (id?: string) => templates.find((t) => t.id === id)?.name ?? "—",
      updateWorkflow,
      updateDraftSteps,
      createDraft,
      publishVersion,
      duplicateWorkflow,
      updateRun,
      addTemplate,
      updateTemplate,
      runEffects,
    }),
    [
      workflows,
      runs,
      templates,
      updateWorkflow,
      updateDraftSteps,
      createDraft,
      publishVersion,
      duplicateWorkflow,
      updateRun,
      addTemplate,
      updateTemplate,
      runEffects,
    ],
  );
}
