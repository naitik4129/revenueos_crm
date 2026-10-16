import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  backend,
  type CreateMeetingInput,
  type CreateProposalInput,
  type CreateTaskInput,
  type CreateTemplateInput,
  type CreateWorkflowInput,
  type TaskListParams,
  type UpdateMeetingInput,
  type UpdateProposalInput,
  type UpdateTaskInput,
  type UpdateTemplateInput,
  type UpdateWorkflowInput,
} from "@/lib/backend-client";
import { initials } from "@/lib/format";
import type {
  LeadLossReason,
  MeetingOutcome,
  ProposalStatus,
  TemplateType,
  User,
  WorkflowStep,
} from "@/types";
import { keys, refreshCrm } from "./query";
import { useWorkspace } from "./workspace-context";

export function useSession() {
  const me = useQuery({
    queryKey: keys.session,
    queryFn: ({ signal }) => backend.me(signal),
    staleTime: 60_000,
  });
  const profiles = useQuery({
    queryKey: keys.profiles,
    queryFn: ({ signal }) => backend.profiles(signal),
    staleTime: 60_000,
  });
  const users: User[] = (profiles.data?.data ?? []).map((user) => ({
    ...user,
    role: "Salesperson",
  }));
  const currentUser: User | null = me.data
    ? {
        id: me.data.id,
        name: me.data.name,
        email: me.data.email,
        initials: initials(me.data.name),
        active: true,
        role: me.data.role === "admin" ? "Admin" : "Salesperson",
      }
    : null;
  return {
    users,
    currentUser,
    userName: (id?: string) => users.find((user) => user.id === id)?.name ?? "Unassigned",
    isLoading: me.isLoading || profiles.isLoading,
    error: me.error ?? profiles.error,
  };
}
export type SessionSlice = ReturnType<typeof useSession>;

/** One page of tasks, filtered on the server. */
export function useTasks(params: TaskListParams = {}) {
  const client = useQueryClient();
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: [...keys.tasks(currentWorkspaceId), params],
    queryFn: ({ signal }) => backend.tasks.list(params, signal),
    enabled: Boolean(currentWorkspaceId),
    placeholderData: keepPreviousData,
  });
  const refresh = () => refreshCrm(client, currentWorkspaceId);
  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => backend.tasks.create(input),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) =>
      backend.tasks.update(id, input),
    onSuccess: refresh,
  });
  const complete = useMutation({
    mutationFn: (id: string) => backend.tasks.complete(id),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string | undefined }) =>
      backend.tasks.cancel(id, reason),
    onSuccess: refresh,
  });
  return {
    tasks: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    isPending: create.isPending || update.isPending || complete.isPending || cancel.isPending,
    addTask: (input: CreateTaskInput) => create.mutateAsync(input),
    updateTask: (id: string, input: UpdateTaskInput) => update.mutateAsync({ id, input }),
    completeTask: (id: string) => complete.mutateAsync(id),
    cancelTask: (id: string, reason?: string) => cancel.mutateAsync({ id, reason }),
  };
}
export type TasksSlice = ReturnType<typeof useTasks>;

/** Matching-task counts for several filter sets (e.g. tab badges); fetches one row each. */
export function useTaskTotals(paramsList: TaskListParams[]) {
  const { currentWorkspaceId } = useWorkspace();
  return useQueries({
    queries: paramsList.map((params) => ({
      queryKey: [...keys.tasks(currentWorkspaceId), { ...params, limit: 1 }],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        backend.tasks.list({ ...params, limit: 1 }, signal),
      enabled: Boolean(currentWorkspaceId),
    })),
  }).map((q) => q.data?.total);
}

export function useMeetings() {
  const client = useQueryClient();
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: keys.meetings(currentWorkspaceId),
    queryFn: ({ signal }) => backend.meetings.list(undefined, signal),
    enabled: Boolean(currentWorkspaceId),
  });
  const refresh = () => refreshCrm(client, currentWorkspaceId);
  const create = useMutation({
    mutationFn: (input: CreateMeetingInput) => backend.meetings.create(input),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMeetingInput }) =>
      backend.meetings.update(id, input),
    onSuccess: refresh,
  });
  const outcome = useMutation({
    mutationFn: ({
      id,
      outcome,
      notes,
    }: {
      id: string;
      outcome: MeetingOutcome;
      notes?: string | undefined;
    }) => backend.meetings.recordOutcome(id, outcome, notes),
    onSuccess: refresh,
  });
  return {
    meetings: query.data?.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    isPending: create.isPending || update.isPending || outcome.isPending,
    addMeeting: (input: CreateMeetingInput) => create.mutateAsync(input),
    updateMeeting: (id: string, input: UpdateMeetingInput) => update.mutateAsync({ id, input }),
    recordOutcome: (id: string, value: MeetingOutcome, notes?: string) =>
      outcome.mutateAsync({ id, outcome: value, notes }),
  };
}
export type MeetingsSlice = ReturnType<typeof useMeetings>;

export function useProposals() {
  const client = useQueryClient();
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: keys.proposals(currentWorkspaceId),
    queryFn: ({ signal }) => backend.proposals.list(undefined, signal),
    enabled: Boolean(currentWorkspaceId),
    // Keeps polling while any proposal's WhatsApp send is still in flight on
    // the worker (email resolves synchronously, but WhatsApp can only be
    // sent from the automation worker process — see Backend/src/worker.ts —
    // so its status flips a few seconds after this list first loads).
    refetchInterval: (q) =>
      q.state.data?.data.some((p) => ["queued", "sending"].includes(p.whatsappSendStatus))
        ? 8000
        : false,
  });
  const refresh = () => refreshCrm(client, currentWorkspaceId);
  const create = useMutation({
    mutationFn: (input: CreateProposalInput) => backend.proposals.create(input),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProposalInput }) =>
      backend.proposals.update(id, input),
    onSuccess: refresh,
  });
  const status = useMutation({
    mutationFn: ({
      id,
      status,
      lossReason,
      lossNotes,
    }: {
      id: string;
      status: ProposalStatus;
      lossReason?: LeadLossReason | undefined;
      lossNotes?: string | undefined;
    }) => backend.proposals.setStatus(id, status, lossReason, lossNotes),
    onSuccess: refresh,
  });
  return {
    proposals: query.data?.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    isPending: create.isPending || update.isPending || status.isPending,
    addProposal: (input: CreateProposalInput) => create.mutateAsync(input),
    updateProposal: (id: string, input: UpdateProposalInput) => update.mutateAsync({ id, input }),
    // lossReason/lossNotes are required by the backend when value is
    // 'rejected'/'expired' — the UI prompts for it first (see
    // proposals-page.tsx) rather than this hook silently omitting it.
    setProposalStatus: (
      id: string,
      value: ProposalStatus,
      lossReason?: LeadLossReason,
      lossNotes?: string,
    ) => status.mutateAsync({ id, status: value, lossReason, lossNotes }),
  };
}
export type ProposalsSlice = ReturnType<typeof useProposals>;

export function useAutomations() {
  const client = useQueryClient();
  const { currentWorkspaceId } = useWorkspace();
  const enabled = Boolean(currentWorkspaceId);
  const workflows = useQuery({
    queryKey: keys.workflows(currentWorkspaceId),
    queryFn: ({ signal }) => backend.workflows.list(signal),
    enabled,
  });
  const templates = useQuery({
    queryKey: keys.templates(currentWorkspaceId),
    queryFn: ({ signal }) => backend.templates.list(signal),
    enabled,
  });
  const runs = useQuery({
    queryKey: keys.runs(currentWorkspaceId),
    queryFn: ({ signal }) => backend.runs.list(undefined, signal),
    enabled,
  });
  const scheduled = useQuery({
    queryKey: keys.scheduledActions(currentWorkspaceId),
    queryFn: ({ signal }) => backend.scheduledActions.list(undefined, signal),
    enabled,
  });
  const invalidate = () =>
    Promise.all([
      refreshCrm(client, currentWorkspaceId),
      client.invalidateQueries({ queryKey: keys.workflows(currentWorkspaceId) }),
      client.invalidateQueries({ queryKey: keys.templates(currentWorkspaceId) }),
    ]);
  const workflowCreate = useMutation({
    mutationFn: (input: CreateWorkflowInput) => backend.workflows.create(input),
    onSuccess: invalidate,
  });
  const workflowUpdate = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWorkflowInput }) =>
      backend.workflows.update(id, input),
    onSuccess: invalidate,
  });
  const draft = useMutation({
    mutationFn: (id: string) => backend.workflows.createDraft(id),
    onSuccess: invalidate,
  });
  const steps = useMutation({
    mutationFn: ({ id, version, steps }: { id: string; version: number; steps: WorkflowStep[] }) =>
      backend.workflows.updateSteps(id, version, steps),
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      backend.workflows.publish(id, version),
    onSuccess: invalidate,
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => backend.workflows.duplicate(id),
    onSuccess: invalidate,
  });
  const workflowDelete = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      backend.workflows.delete(id, force),
    onSuccess: invalidate,
  });
  const workflowVersionDelete = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      backend.workflows.deleteVersion(id, version),
    onSuccess: invalidate,
  });
  const runAction = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "pause" | "resume" | "cancel" | "retry";
    }) =>
      action === "pause"
        ? backend.runs.pause(id)
        : action === "resume"
          ? backend.runs.resume(id)
          : action === "cancel"
            ? backend.runs.cancel(id)
            : backend.runs.retry(id),
    onSuccess: invalidate,
  });
  const enroll = useMutation({
    mutationFn: (input: { dealId: string; workflowId: string; reason?: string | undefined }) =>
      backend.runs.create(input),
    onSuccess: invalidate,
  });
  const templateCreate = useMutation({
    mutationFn: (input: CreateTemplateInput) => backend.templates.create(input),
    onSuccess: invalidate,
  });
  const templateUpdate = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTemplateInput }) =>
      backend.templates.update(id, input),
    onSuccess: invalidate,
  });
  const templateDelete = useMutation({
    mutationFn: (id: string) => backend.templates.delete(id),
    onSuccess: invalidate,
  });
  const templateAttachmentUpload = useMutation({
    mutationFn: ({ templateId, file }: { templateId: string; file: File }) =>
      backend.templates.uploadAttachment(templateId, file),
    onSuccess: invalidate,
  });
  const templateAttachmentDelete = useMutation({
    mutationFn: ({ templateId, attachmentId }: { templateId: string; attachmentId: string }) =>
      backend.templates.deleteAttachment(templateId, attachmentId),
    onSuccess: invalidate,
  });
  const workflowList = workflows.data?.data ?? [];
  return {
    workflows: workflowList,
    templates: templates.data?.data ?? [],
    runs: runs.data?.data ?? [],
    scheduledActions: scheduled.data?.data ?? [],
    isLoading: workflows.isLoading || templates.isLoading || runs.isLoading || scheduled.isLoading,
    error: workflows.error ?? templates.error ?? runs.error ?? scheduled.error,
    isPending: [
      workflowCreate,
      workflowUpdate,
      draft,
      steps,
      publish,
      duplicate,
      workflowDelete,
      workflowVersionDelete,
      runAction,
      enroll,
      templateCreate,
      templateUpdate,
      templateDelete,
      templateAttachmentUpload,
      templateAttachmentDelete,
    ].some((mutation) => mutation.isPending),
    templateName: (id?: string) =>
      templates.data?.data.find((template) => template.id === id)?.name ?? "-",
    addWorkflow: (input: CreateWorkflowInput) => workflowCreate.mutateAsync(input),
    updateWorkflow: (id: string, input: UpdateWorkflowInput) =>
      workflowUpdate.mutateAsync({ id, input }),
    createDraft: async (id: string) => {
      const workflow = await draft.mutateAsync(id);
      return (
        workflow.versions.find((version) => version.status === "draft")?.version ??
        workflow.currentVersion
      );
    },
    updateDraftSteps: (id: string, version: number, value: WorkflowStep[]) =>
      steps.mutateAsync({ id, version, steps: value }),
    publishVersion: (id: string, version: number) => publish.mutateAsync({ id, version }),
    duplicateWorkflow: (id: string) => duplicate.mutateAsync(id),
    deleteWorkflow: (id: string, force?: boolean) =>
      workflowDelete.mutateAsync(force !== undefined ? { id, force } : { id }),
    deleteWorkflowVersion: (id: string, version: number) =>
      workflowVersionDelete.mutateAsync({ id, version }),
    pauseRun: (id: string) => runAction.mutateAsync({ id, action: "pause" }),
    resumeRun: (id: string) => runAction.mutateAsync({ id, action: "resume" }),
    cancelRun: (id: string) => runAction.mutateAsync({ id, action: "cancel" }),
    retryRun: (id: string) => runAction.mutateAsync({ id, action: "retry" }),
    enrollDeal: (dealId: string, workflowId: string, reason?: string) =>
      enroll.mutateAsync({ dealId, workflowId, reason }),
    addTemplate: (input: { name: string; type: TemplateType; subject: string; body: string }) =>
      templateCreate.mutateAsync({
        name: input.name,
        channel: input.type,
        subject: input.subject,
        body: input.body,
      }),
    updateTemplate: (id: string, input: UpdateTemplateInput) =>
      templateUpdate.mutateAsync({ id, input }),
    deleteTemplate: (id: string) => templateDelete.mutateAsync(id),
    uploadTemplateAttachment: (templateId: string, file: File) =>
      templateAttachmentUpload.mutateAsync({ templateId, file }),
    deleteTemplateAttachment: (templateId: string, attachmentId: string) =>
      templateAttachmentDelete.mutateAsync({ templateId, attachmentId }),
  };
}
export type AutomationsSlice = ReturnType<typeof useAutomations>;

export function useNotifications() {
  const client = useQueryClient();
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: keys.notifications(currentWorkspaceId),
    queryFn: ({ signal }) => backend.notifications.list(signal),
    enabled: Boolean(currentWorkspaceId),
    // New handovers and WhatsApp replies arrive without any action in this tab.
    refetchInterval: 60_000,
  });
  const readAll = useMutation({
    mutationFn: () => backend.notifications.markAllRead(),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications(currentWorkspaceId) }),
  });
  return {
    notifications: query.data?.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    markNotificationsRead: () => readAll.mutateAsync(),
  };
}
export type NotificationsSlice = ReturnType<typeof useNotifications>;

export function useDashboard() {
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: keys.dashboard(currentWorkspaceId),
    queryFn: ({ signal }) => backend.dashboard.summary(signal),
    enabled: Boolean(currentWorkspaceId),
  });
  return { summary: query.data, isLoading: query.isLoading, error: query.error };
}
