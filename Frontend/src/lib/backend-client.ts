import { backendBaseUrl, configurationError, supabase } from "./supabase-client";
import type {
  AppNotification,
  AutomationMode,
  Call,
  CallConnectedOutcome,
  CallNotConnectedReason,
  Contactability,
  Lead,
  LeadNote,
  LeadSource,
  LifecycleState,
  Meeting,
  MeetingOutcome,
  MeetingStatus,
  PipelineStage,
  Proposal,
  ProposalStatus,
  ResponseState,
  Run,
  ScheduledAction,
  Task,
  TaskType,
  Template,
  TimelineEvent,
  User,
  Workflow,
  WorkflowStep,
  WorkflowTrigger,
} from "@/types";

export class BackendError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (configurationError || !backendBaseUrl || !supabase)
    throw new BackendError(
      0,
      "configuration_error",
      configurationError ?? "Frontend is not configured.",
    );
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token)
    throw new BackendError(401, "authentication_failed", "Authentication is required.");
  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session.access_token}`,
        ...init.headers,
      },
    });
  } catch (error) {
    throw new BackendError(
      0,
      "network_error",
      error instanceof Error ? error.message : "Backend request failed.",
    );
  }
  const body = (await response.json().catch(() => undefined)) as
    { error?: { code?: string; message?: string; details?: unknown } } | undefined;
  if (!response.ok) {
    if (response.status === 401) void supabase.auth.signOut({ scope: "local" });
    throw new BackendError(
      response.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? response.statusText,
      body?.error?.details,
    );
  }
  return body as T;
}

function query(path: string, params?: Record<string, string | number | boolean | undefined>) {
  if (!params) return path;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) search.set(key, String(value));
  });
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}
const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : {});
const send = <T>(method: "POST" | "PATCH" | "PUT", path: string, body?: unknown) =>
  request<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const del = (path: string) => request<void>(path, { method: "DELETE" });

export interface CreateLeadInput {
  firstName: string;
  lastName?: string | undefined;
  company: string;
  jobTitle?: string | undefined;
  industry?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  source: LeadSource;
  serviceInterest?: string | undefined;
  ownerId?: string | undefined;
}
export interface UpdateLeadInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  company?: string | undefined;
  jobTitle?: string | undefined;
  industry?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  source?: LeadSource | undefined;
  serviceInterest?: string | undefined;
  ownerId?: string | undefined;
  pipelineStage?: PipelineStage | undefined;
  responseState?: ResponseState | undefined;
}
export interface LeadFilters {
  stage?: PipelineStage;
  lifecycle?: LifecycleState;
  ownerId?: string;
  source?: LeadSource;
  automationMode?: AutomationMode;
  search?: string;
  limit?: number;
  offset?: number;
}
export interface LogCallInput {
  connected: boolean;
  notConnectedReason?: CallNotConnectedReason | undefined;
  connectedOutcome?: CallConnectedOutcome | undefined;
  notes?: string | undefined;
  callbackDueAt?: string | undefined;
}
export interface CreateTaskInput {
  leadId: string;
  ownerId?: string | undefined;
  type: TaskType;
  title: string;
  dueAt: string;
}
export interface UpdateTaskInput {
  ownerId?: string | undefined;
  type?: TaskType | undefined;
  title?: string | undefined;
  dueAt?: string | undefined;
}
export interface CreateMeetingInput {
  leadId: string;
  ownerId?: string | undefined;
  title: string;
  at: string;
  durationMin?: number | undefined;
  url?: string | undefined;
}
export interface UpdateMeetingInput {
  title?: string | undefined;
  at?: string | undefined;
  durationMin?: number | undefined;
  url?: string | undefined;
  status?: MeetingStatus | undefined;
  notes?: string | undefined;
}
export interface CreateProposalInput {
  leadId: string;
  title: string;
  fileName?: string | undefined;
  amount?: number | undefined;
  notes?: string | undefined;
}
export interface UpdateProposalInput {
  title?: string | undefined;
  fileName?: string | undefined;
  amount?: number | undefined;
  notes?: string | undefined;
}
export interface CreateWorkflowInput {
  name: string;
  description?: string | undefined;
  trigger: WorkflowTrigger;
  ownerId?: string | undefined;
}
export interface UpdateWorkflowInput {
  name?: string | undefined;
  description?: string | undefined;
  trigger?: WorkflowTrigger | undefined;
  status?: "active" | "paused" | undefined;
  ownerId?: string | undefined;
}
export interface CreateTemplateInput {
  name: string;
  channel: "email" | "whatsapp";
  subject?: string | undefined;
  body: string;
  attachment?: string | undefined;
}
export interface UpdateTemplateInput {
  name?: string | undefined;
  subject?: string | undefined;
  body?: string | undefined;
  attachment?: string | undefined;
  active?: boolean | undefined;
}

export interface DashboardSummary {
  activeLeads: number;
  tasksDueToday: number;
  overdueActions: number;
  meetingsToday: number;
  proposalFollowUps: number;
  leadsWithNoNextAction: number;
  automationFailures: number;
  pipelineFunnel: { label: string; value: number }[];
  todaysQueue: {
    id: string;
    leadId: string;
    title: string;
    type: TaskType;
    dueAt: string;
    ownerId?: string;
  }[];
}

export const backend = {
  me: (signal?: AbortSignal) => get<{ id: string; name: string; email: string }>("/me", signal),
  profiles: (signal?: AbortSignal) => get<{ data: Omit<User, "role">[] }>("/profiles", signal),
  leads: {
    list: (params?: LeadFilters, signal?: AbortSignal) =>
      get<{ data: Lead[] }>(
        query("/leads", params as Record<string, string | number | undefined>),
        signal,
      ),
    get: (id: string, signal?: AbortSignal) => get<Lead>(`/leads/${id}`, signal),
    create: (input: CreateLeadInput) => send<Lead>("POST", "/leads", input),
    update: (id: string, fields: UpdateLeadInput) => send<Lead>("PATCH", `/leads/${id}`, fields),
    addNote: (id: string, body: string) => send<LeadNote>("POST", `/leads/${id}/notes`, { body }),
    notes: (id: string, signal?: AbortSignal) =>
      get<{ data: LeadNote[] }>(`/leads/${id}/notes`, signal),
    contactability: (id: string, signal?: AbortSignal) =>
      get<{ data: Contactability[] }>(`/leads/${id}/contactability`, signal),
    setAutomation: (id: string, mode: AutomationMode, reason?: string) =>
      send<Lead>("POST", `/leads/${id}/automation`, { mode, reason }),
    markDnc: (id: string, reason: string) => send<Lead>("POST", `/leads/${id}/dnc`, { reason }),
    reactivateFromDnc: (id: string, reason: string) =>
      send<Lead>("POST", `/leads/${id}/dnc/reactivate`, { reason }),
    markWon: (id: string, reason?: string) => send<Lead>("POST", `/leads/${id}/won`, { reason }),
    markLost: (id: string, reason?: string) => send<Lead>("POST", `/leads/${id}/lost`, { reason }),
    discard: (id: string, reason?: string) =>
      send<Lead>("POST", `/leads/${id}/discard`, { reason }),
    reactivate: (id: string, reason?: string) =>
      send<Lead>("POST", `/leads/${id}/reactivate`, { reason }),
    logCall: (id: string, input: LogCallInput) =>
      send<{
        call: Call;
        lead: Lead;
        workflowTrigger?: WorkflowTrigger;
        promptScheduleMeeting?: boolean;
      }>("POST", `/leads/${id}/calls`, input),
    calls: (id: string, signal?: AbortSignal) =>
      get<{ data: Call[] }>(`/leads/${id}/calls`, signal),
    timeline: (id: string, signal?: AbortSignal) =>
      get<{ data: TimelineEvent[] }>(`/leads/${id}/timeline`, signal),
    meetings: (id: string, signal?: AbortSignal) =>
      get<{ data: Meeting[] }>(`/leads/${id}/meetings`, signal),
    proposals: (id: string, signal?: AbortSignal) =>
      get<{ data: Proposal[] }>(`/leads/${id}/proposals`, signal),
    runs: (id: string, signal?: AbortSignal) => get<{ data: Run[] }>(`/leads/${id}/runs`, signal),
    logCommunication: (id: string, channel: "email" | "whatsapp", detail?: string) =>
      send<{ channel: string; title: string }>("POST", `/leads/${id}/communications`, {
        channel,
        detail,
      }),
  },
  tasks: {
    list: (params?: Record<string, string | boolean | undefined>, signal?: AbortSignal) =>
      get<{ data: Task[] }>(query("/tasks", params), signal),
    create: (input: CreateTaskInput) => send<Task>("POST", "/tasks", input),
    update: (id: string, input: UpdateTaskInput) => send<Task>("PATCH", `/tasks/${id}`, input),
    complete: (id: string) => send<Task>("POST", `/tasks/${id}/complete`),
    cancel: (id: string, reason?: string) => send<Task>("POST", `/tasks/${id}/cancel`, { reason }),
  },
  meetings: {
    list: (params?: Record<string, string | undefined>, signal?: AbortSignal) =>
      get<{ data: Meeting[] }>(query("/meetings", params), signal),
    create: (input: CreateMeetingInput) => send<Meeting>("POST", "/meetings", input),
    update: (id: string, input: UpdateMeetingInput) =>
      send<Meeting>("PATCH", `/meetings/${id}`, input),
    recordOutcome: (id: string, outcome: MeetingOutcome, notes?: string) =>
      send<Meeting>("POST", `/meetings/${id}/outcome`, { outcome, notes }),
  },
  proposals: {
    list: (params?: Record<string, string | undefined>, signal?: AbortSignal) =>
      get<{ data: Proposal[] }>(query("/proposals", params), signal),
    create: (input: CreateProposalInput) => send<Proposal>("POST", "/proposals", input),
    update: (id: string, input: UpdateProposalInput) =>
      send<Proposal>("PATCH", `/proposals/${id}`, input),
    setStatus: (id: string, status: ProposalStatus) =>
      send<Proposal>("POST", `/proposals/${id}/status`, { status }),
  },
  workflows: {
    list: (signal?: AbortSignal) => get<{ data: Workflow[] }>("/workflows", signal),
    get: (id: string, signal?: AbortSignal) => get<Workflow>(`/workflows/${id}`, signal),
    create: (input: CreateWorkflowInput) => send<Workflow>("POST", "/workflows", input),
    update: (id: string, input: UpdateWorkflowInput) =>
      send<Workflow>("PATCH", `/workflows/${id}`, input),
    createDraft: (id: string) => send<Workflow>("POST", `/workflows/${id}/draft`),
    updateSteps: (id: string, version: number, steps: WorkflowStep[]) =>
      send<Workflow>("PUT", `/workflows/${id}/versions/${version}/steps`, {
        steps: steps.map((step, order) => ({
          order,
          delayDays: step.delayDays,
          action: step.action,
          templateId: step.templateId ?? null,
          config: step.config ?? null,
          enabled: step.enabled,
        })),
      }),
    publish: (id: string, version: number) =>
      send<Workflow>("POST", `/workflows/${id}/versions/${version}/publish`, {
        enrollmentMode: "keep_existing",
      }),
    duplicate: (id: string) => send<Workflow>("POST", `/workflows/${id}/duplicate`),
    delete: (id: string, force?: boolean) => del(`/workflows/${id}${force ? "?force=true" : ""}`),
  },
  templates: {
    list: (signal?: AbortSignal) => get<{ data: Template[] }>("/templates", signal),
    create: (input: CreateTemplateInput) => send<Template>("POST", "/templates", input),
    update: (id: string, input: UpdateTemplateInput) =>
      send<Template>("PATCH", `/templates/${id}`, input),
    delete: (id: string) => del(`/templates/${id}`),
  },
  runs: {
    list: (params?: Record<string, string | undefined>, signal?: AbortSignal) =>
      get<{ data: Run[] }>(query("/runs", params), signal),
    create: (input: { leadId: string; workflowId: string; reason?: string | undefined }) =>
      send<{ data: Run[] }>("POST", "/runs", input),
    pause: (id: string, reason?: string) => send<Run>("POST", `/runs/${id}/pause`, { reason }),
    resume: (id: string) => send<Run>("POST", `/runs/${id}/resume`),
    cancel: (id: string, reason?: string) => send<Run>("POST", `/runs/${id}/cancel`, { reason }),
    retry: (id: string) => send<Run>("POST", `/runs/${id}/retry`),
  },
  scheduledActions: {
    list: (params?: Record<string, string | undefined>, signal?: AbortSignal) =>
      get<{ data: ScheduledAction[] }>(query("/scheduled-actions", params), signal),
  },
  dashboard: {
    summary: (signal?: AbortSignal) => get<DashboardSummary>("/dashboard/summary", signal),
  },
  notifications: {
    list: (signal?: AbortSignal) => get<{ data: AppNotification[] }>("/notifications", signal),
    markRead: (id: string) => send<AppNotification>("POST", `/notifications/${id}/read`),
    markAllRead: () => send<{ data: AppNotification[] }>("POST", "/notifications/read-all"),
  },
};
