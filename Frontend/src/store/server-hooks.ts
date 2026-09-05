import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  backend,
  type CreateLeadInput,
  type CreateMeetingInput,
  type CreateProposalInput,
  type CreateTaskInput,
  type CreateTemplateInput,
  type CreateWorkflowInput,
  type ImportLeadRow,
  type LogCallInput,
  type UpdateLeadInput,
  type UpdateMeetingInput,
  type UpdateProposalInput,
  type UpdateTaskInput,
  type UpdateTemplateInput,
  type UpdateWorkflowInput,
} from "@/lib/backend-client";
import { initials } from "@/lib/format";
import type {
  AutomationMode,
  LeadLossReason,
  MeetingOutcome,
  ProposalStatus,
  TemplateType,
  User,
  WorkflowStep,
} from "@/types";
import { keys, refreshLead } from "./query";

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

export function useLeads() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: keys.leads,
    queryFn: ({ signal }) => backend.leads.list({ limit: 500 }, signal),
  });
  const refresh = (leadId: string) => refreshLead(client, leadId);
  const create = useMutation({
    mutationFn: (input: CreateLeadInput) => backend.leads.create(input),
    onSuccess: (lead) => refresh(lead.id),
  });
  const importCsv = useMutation({
    mutationFn: (rows: ImportLeadRow[]) => backend.leads.importCsv(rows),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.leads }),
        client.invalidateQueries({ queryKey: keys.dashboard }),
        client.invalidateQueries({ queryKey: keys.notifications }),
      ]),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLeadInput }) =>
      backend.leads.update(id, input),
    onSuccess: (lead) => refresh(lead.id),
  });
  const note = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => backend.leads.addNote(id, body),
    onSuccess: (_, vars) => refresh(vars.id),
  });
  const remove = useMutation({
    mutationFn: (id: string) => backend.leads.delete(id),
    onSuccess: (_, id) => refresh(id),
  });
  const automation = useMutation({
    mutationFn: ({
      id,
      mode,
      reason,
    }: {
      id: string;
      mode: AutomationMode;
      reason?: string | undefined;
    }) => backend.leads.setAutomation(id, mode, reason),
    onSuccess: (lead) => refresh(lead.id),
  });
  const dnc = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      backend.leads.markDnc(id, reason),
    onSuccess: (lead) => refresh(lead.id),
  });
  const dncReactivate = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      backend.leads.reactivateFromDnc(id, reason),
    onSuccess: (lead) => refresh(lead.id),
  });
  const call = useMutation({
    mutationFn: ({ id, input }: { id: string; input: LogCallInput }) =>
      backend.leads.logCall(id, input),
    onSuccess: (result) => refresh(result.lead.id),
  });
  const communication = useMutation({
    mutationFn: ({
      id,
      channel,
      detail,
    }: {
      id: string;
      channel: "email" | "whatsapp";
      detail?: string | undefined;
    }) => backend.leads.logCommunication(id, channel, detail),
    onSuccess: (_, vars) => refresh(vars.id),
  });
  const lifecycle = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
      lossReason,
    }: {
      id: string;
      action: "won" | "lost" | "discard" | "reactivate" | "long_term_nurture";
      reason?: string | undefined;
      /** Required by the backend when action === 'lost'. */
      lossReason?: LeadLossReason | undefined;
    }) =>
      action === "won"
        ? backend.leads.markWon(id, reason)
        : action === "lost"
          ? backend.leads.markLost(id, lossReason!, reason)
          : action === "discard"
            ? backend.leads.discard(id, reason)
            : action === "long_term_nurture"
              ? backend.leads.longTermNurture(id, reason)
              : backend.leads.reactivate(id, reason),
    onSuccess: (lead) => refresh(lead.id),
  });
  const leads = query.data?.data ?? [];
  const isPending = [
    create,
    importCsv,
    update,
    remove,
    note,
    automation,
    dnc,
    dncReactivate,
    call,
    communication,
    lifecycle,
  ].some((mutation) => mutation.isPending);
  return {
    leads,
    getLead: (id: string) => leads.find((lead) => lead.id === id),
    isLoading: query.isLoading,
    error: query.error,
    isPending,
    addLead: (input: CreateLeadInput) => create.mutateAsync(input),
    importLeadsCsv: (rows: ImportLeadRow[]) => importCsv.mutateAsync(rows),
    updateLead: (id: string, input: UpdateLeadInput) => update.mutateAsync({ id, input }),
    deleteLead: (id: string) => remove.mutateAsync(id),
    addNote: (id: string, body: string) => note.mutateAsync({ id, body }),
    setAutomation: (id: string, mode: AutomationMode, reason?: string) =>
      automation.mutateAsync({ id, mode, reason }),
    markDnc: (id: string, reason: string) => dnc.mutateAsync({ id, reason }),
    reactivateFromDnc: (id: string, reason: string) => dncReactivate.mutateAsync({ id, reason }),
    logCall: (id: string, input: LogCallInput) => call.mutateAsync({ id, input }),
    logCommunication: (id: string, channel: "email" | "whatsapp", detail?: string) =>
      communication.mutateAsync({ id, channel, detail }),
    setLifecycle: (
      id: string,
      action: "won" | "lost" | "discard" | "reactivate" | "long_term_nurture",
      reason?: string,
      lossReason?: LeadLossReason,
    ) => lifecycle.mutateAsync({ id, action, reason, lossReason }),
  };
}
export type LeadsSlice = ReturnType<typeof useLeads>;

export function useLead(leadId: string) {
  const lead = useQuery({
    queryKey: keys.lead(leadId),
    queryFn: ({ signal }) => backend.leads.get(leadId, signal),
    enabled: Boolean(leadId),
  });
  const notes = useQuery({
    queryKey: keys.notes(leadId),
    queryFn: ({ signal }) => backend.leads.notes(leadId, signal),
    enabled: Boolean(leadId),
  });
  const contactability = useQuery({
    queryKey: keys.contactability(leadId),
    queryFn: ({ signal }) => backend.leads.contactability(leadId, signal),
    enabled: Boolean(leadId),
  });
  return {
    lead: lead.data,
    notes: notes.data?.data ?? [],
    contactability: contactability.data?.data ?? [],
    isLoading: lead.isLoading || notes.isLoading || contactability.isLoading,
    error: lead.error ?? notes.error ?? contactability.error,
  };
}

export function useTasks() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: keys.tasks,
    queryFn: ({ signal }) => backend.tasks.list(undefined, signal),
  });
  const refresh = (leadId: string) => refreshLead(client, leadId);
  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => backend.tasks.create(input),
    onSuccess: (task) => refresh(task.leadId),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) =>
      backend.tasks.update(id, input),
    onSuccess: (task) => refresh(task.leadId),
  });
  const complete = useMutation({
    mutationFn: (id: string) => backend.tasks.complete(id),
    onSuccess: (task) => refresh(task.leadId),
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string | undefined }) =>
      backend.tasks.cancel(id, reason),
    onSuccess: (task) => refresh(task.leadId),
  });
  return {
    tasks: query.data?.data ?? [],
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

export function useMeetings() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: keys.meetings,
    queryFn: ({ signal }) => backend.meetings.list(undefined, signal),
  });
  const refresh = (leadId: string) => refreshLead(client, leadId);
  const create = useMutation({
    mutationFn: (input: CreateMeetingInput) => backend.meetings.create(input),
    onSuccess: (meeting) => refresh(meeting.leadId),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMeetingInput }) =>
      backend.meetings.update(id, input),
    onSuccess: (meeting) => refresh(meeting.leadId),
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
    onSuccess: (meeting) => refresh(meeting.leadId),
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
  const query = useQuery({
    queryKey: keys.proposals,
    queryFn: ({ signal }) => backend.proposals.list(undefined, signal),
    // Keeps polling while any proposal's WhatsApp send is still in flight on
    // the worker (email resolves synchronously, but WhatsApp can only be
    // sent from the automation worker process — see Backend/src/worker.ts —
    // so its status flips a few seconds after this list first loads).
    refetchInterval: (q) =>
      q.state.data?.data.some((p) => ["queued", "sending"].includes(p.whatsappSendStatus))
        ? 8000
        : false,
  });
  const refresh = (leadId: string) => refreshLead(client, leadId);
  const create = useMutation({
    mutationFn: (input: CreateProposalInput) => backend.proposals.create(input),
    onSuccess: (proposal) => refresh(proposal.leadId),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProposalInput }) =>
      backend.proposals.update(id, input),
    onSuccess: (proposal) => refresh(proposal.leadId),
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
    onSuccess: (proposal) => refresh(proposal.leadId),
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

export function useTimeline(leadId: string) {
  const query = useQuery({
    queryKey: keys.timeline(leadId),
    queryFn: ({ signal }) => backend.leads.timeline(leadId, signal),
    enabled: Boolean(leadId),
  });
  return { timeline: query.data?.data ?? [], isLoading: query.isLoading, error: query.error };
}
export type TimelineSlice = ReturnType<typeof useTimeline>;

export function useAutomations() {
  const client = useQueryClient();
  const workflows = useQuery({
    queryKey: keys.workflows,
    queryFn: ({ signal }) => backend.workflows.list(signal),
  });
  const templates = useQuery({
    queryKey: keys.templates,
    queryFn: ({ signal }) => backend.templates.list(signal),
  });
  const runs = useQuery({
    queryKey: keys.runs,
    queryFn: ({ signal }) => backend.runs.list(undefined, signal),
  });
  const scheduled = useQuery({
    queryKey: keys.scheduledActions,
    queryFn: ({ signal }) => backend.scheduledActions.list(undefined, signal),
  });
  const invalidate = () =>
    Promise.all(
      [keys.workflows, keys.templates, keys.runs, keys.scheduledActions, keys.dashboard].map(
        (queryKey) => client.invalidateQueries({ queryKey }),
      ),
    );
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
    mutationFn: (input: { leadId: string; workflowId: string; reason?: string | undefined }) =>
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
      runAction,
      enroll,
      templateCreate,
      templateUpdate,
      templateDelete,
      templateAttachmentUpload,
      templateAttachmentDelete,
    ].some((mutation) => mutation.isPending),
    templateName: (id?: string) =>
      templates.data?.data.find((template) => template.id === id)?.name ?? "—",
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
    pauseRun: (id: string) => runAction.mutateAsync({ id, action: "pause" }),
    resumeRun: (id: string) => runAction.mutateAsync({ id, action: "resume" }),
    cancelRun: (id: string) => runAction.mutateAsync({ id, action: "cancel" }),
    retryRun: (id: string) => runAction.mutateAsync({ id, action: "retry" }),
    enrollLead: (leadId: string, workflowId: string, reason?: string) =>
      enroll.mutateAsync({ leadId, workflowId, reason }),
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
  const query = useQuery({
    queryKey: keys.notifications,
    queryFn: ({ signal }) => backend.notifications.list(signal),
  });
  const readAll = useMutation({
    mutationFn: () => backend.notifications.markAllRead(),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
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
  const query = useQuery({
    queryKey: keys.dashboard,
    queryFn: ({ signal }) => backend.dashboard.summary(signal),
  });
  return { summary: query.data, isLoading: query.isLoading, error: query.error };
}
