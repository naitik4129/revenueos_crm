import { backendBaseUrl, configurationError, supabase } from "./supabase-client";
import type {
  AppNotification,
  AutomationMode,
  Company,
  Contact,
  ContactCall,
  ContactNote,
  ContactStatus,
  CrmTimelineEvent,
  DashboardSummary,
  Deal,
  DealOutcome,
  EmailActivity,
  ImportContactsResult,
  CallConnectedOutcome,
  CallNotConnectedReason,
  Contactability,
  LeadLossReason,
  LifecycleStage,
  LogCallResult,
  Meeting,
  MeetingOutcome,
  MeetingStatus,
  Paged,
  PipelineStage,
  Proposal,
  ProposalStatus,
  ResponseState,
  Run,
  ScheduledAction,
  Task,
  TaskType,
  Template,
  TemplateAttachment,
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

// The currently-selected workspace, set by WorkspaceProvider (see
// store/workspace-context.tsx) whenever the user's selection changes.
// Attached as X-Workspace-Id on every CRM request below — every route
// except /me, /profiles, and /workspaces itself requires it server-side.
let currentWorkspaceId: string | null = null;
export function setCurrentWorkspaceId(id: string | null) {
  currentWorkspaceId = id;
}
export function getCurrentWorkspaceId() {
  return currentWorkspaceId;
}
function workspaceHeaders(): Record<string, string> {
  return currentWorkspaceId ? { "X-Workspace-Id": currentWorkspaceId } : {};
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
        ...workspaceHeaders(),
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

export type TaskListParams = Partial<
  Record<"ownerId" | "dealId" | "contactId" | "status" | "type", string | undefined> &
    Record<"overdueOnly" | "dueTodayOnly" | "upcomingOnly", boolean | undefined> &
    Record<"limit" | "offset", number | undefined>
>;

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

/** Like `request`, but for a multipart/form-data body — omits the JSON Content-Type header so the browser sets the multipart boundary itself. */
async function uploadFile<T>(path: string, formData: FormData): Promise<T> {
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
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...workspaceHeaders() },
      body: formData,
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

export interface LogCallInput {
  connected: boolean;
  notConnectedReason?: CallNotConnectedReason | undefined;
  connectedOutcome?: CallConnectedOutcome | undefined;
  notes?: string | undefined;
  callbackDueAt?: string | undefined;
  taskId?: string | undefined;
  /** "Interested - Later" capture — read by the backend only when connectedOutcome === 'interested_later'. */
  interestedLater?:
    | {
        reason?: string | undefined;
        restartAt?: string | undefined;
        nextAction?: string | undefined;
        decisionOwner?: string | undefined;
      }
    | undefined;
}
export interface CreateTaskInput {
  dealId?: string | undefined;
  contactId?: string | undefined;
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
  dealId: string;
  ownerId?: string | undefined;
  title: string;
  at: string;
  durationMin?: number | undefined;
  url?: string | undefined;
  participants?: { name?: string | undefined; email: string }[] | undefined;
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
  dealId: string;
  title: string;
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
}
export interface UpdateTemplateInput {
  name?: string | undefined;
  subject?: string | undefined;
  body?: string | undefined;
  active?: boolean | undefined;
  isDefaultMeetingScheduled?: boolean | undefined;
}

export interface Page {
  limit?: number | undefined;
  offset?: number | undefined;
}
export interface ContactFilters extends Page {
  search?: string | undefined;
  lifecycleStage?: LifecycleStage | undefined;
  status?: ContactStatus | undefined;
  ownerId?: string | undefined;
  companyId?: string | undefined;
}
export interface ContactInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  jobTitle?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  linkedinUrl?: string | undefined;
  country?: string | undefined;
  location?: string | undefined;
  source?: string | undefined;
  companyId?: string | null | undefined;
  ownerId?: string | null | undefined;
}
export interface ImportContactRow {
  rowNumber: number;
  firstName: string;
  lastName?: string | undefined;
  jobTitle?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  linkedinUrl?: string | undefined;
  country?: string | undefined;
  location?: string | undefined;
  source?: string | undefined;
  company?: string | undefined;
  website?: string | undefined;
  industry?: string | undefined;
  createDeal?: string | undefined;
  dealTitle?: string | undefined;
}
export interface CompanyInput {
  name?: string | undefined;
  domain?: string | null | undefined;
  website?: string | null | undefined;
  industry?: string | null | undefined;
  phone?: string | null | undefined;
  city?: string | null | undefined;
  country?: string | null | undefined;
  location?: string | null | undefined;
  headcount?: number | null | undefined;
  linkedinUrl?: string | null | undefined;
  ownerId?: string | null | undefined;
}
export interface CompanyFilters extends Page {
  search?: string | undefined;
  ownerId?: string | undefined;
  industry?: string | undefined;
}
export interface DealFilters extends Page {
  outcome?: DealOutcome | undefined;
  stage?: PipelineStage | undefined;
  ownerId?: string | undefined;
  automationMode?: AutomationMode | undefined;
  contactId?: string | undefined;
  companyId?: string | undefined;
  missingNextAction?: boolean | undefined;
  search?: string | undefined;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  initials: string;
  active: boolean;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  platformProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailConnection {
  provider: "resend" | "smtp" | null;
  enabled: boolean;
  senderName: string;
  senderAddress: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "starttls";
  resendApiKeyConfigured: boolean;
  smtpUsernameConfigured: boolean;
  smtpPasswordConfigured: boolean;
  environmentFallbackConfigured: boolean;
  source: "database" | "environment" | "unconfigured";
  updatedAt: string;
}

export interface WhatsAppConnection {
  enabled: boolean;
  desiredState: string;
  status: string;
  connectedPhone: string | null;
  displayName: string | null;
  qr: string | null;
  qrExpiresAt: string | null;
  lastError: string | null;
  reachoutLock: unknown;
  newChatCap: unknown;
  workerHeartbeatAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  dailyCap: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  todayCount: number;
  pendingCount: number;
  invalidPhoneCount: number;
  outboundRestricted: boolean;
  inboundReview: {
    messageId: string;
    senderPhoneE164: string | null;
    messageType: string;
    receivedAt: string;
    matchCount: number;
    disposition: "unmatched" | "ambiguous";
  }[];
}

export interface GoogleCalendarConnection {
  configured: boolean;
  /** The server has a shared Google app, so users can connect with one click. */
  platformConfigured: boolean;
  /** This workspace saved its own OAuth client (the "advanced" override). */
  usesOwnCredentials: boolean;
  enabled: boolean;
  status: "disconnected" | "connected" | "error";
  clientId: string | null;
  redirectUri: string | null;
  clientSecretConfigured: boolean;
  connectedEmail: string | null;
  connectedCalendarId: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export const backend = {
  me: (signal?: AbortSignal) =>
    get<{ id: string; name: string; email: string; role: "admin" | "salesperson" }>("/me", signal),
  profiles: (signal?: AbortSignal) => get<{ data: Omit<User, "role">[] }>("/profiles", signal),
  admin: {
    users: {
      list: (signal?: AbortSignal) => get<{ data: AdminUser[] }>("/admin/users", signal),
      create: (input: { name: string; email: string; password: string }) =>
        send<AdminUser>("POST", "/admin/users", input),
      update: (
        id: string,
        input: { name?: string; email?: string; password?: string; active?: boolean },
      ) => send<AdminUser>("PATCH", `/admin/users/${id}`, input),
    },
  },
  workspaces: {
    list: (signal?: AbortSignal) => get<{ data: Workspace[] }>("/workspaces", signal),
    create: (name: string) => send<Workspace>("POST", "/workspaces", { name }),
    rename: (id: string, name: string) => send<Workspace>("PATCH", `/workspaces/${id}`, { name }),
  },
  connections: {
    email: {
      get: (signal?: AbortSignal) => get<EmailConnection>("/connections/email", signal),
      update: (input: {
        provider: "resend" | "smtp";
        enabled: boolean;
        senderName: string;
        senderAddress: string;
        resendApiKey?: string;
        smtpHost?: string;
        smtpPort?: number;
        smtpSecurity?: "tls" | "starttls";
        smtpUsername?: string;
        smtpPassword?: string;
      }) => send<EmailConnection>("PUT", "/connections/email", input),
      test: (to: string) =>
        send<{ ok: boolean; providerMessageId: string }>("POST", "/connections/email/test", {
          to,
        }),
    },
    whatsapp: {
      get: (signal?: AbortSignal) =>
        get<WhatsAppConnection>("/connections/whatsapp/settings", signal),
      update: (input: { enabled: boolean; dailyCap: number }) =>
        send<WhatsAppConnection>("PUT", "/connections/whatsapp/settings", input),
      command: (command: "connect" | "restart" | "logout") =>
        send<WhatsAppConnection>("POST", `/connections/whatsapp/${command}`),
    },
    googleCalendar: {
      get: (signal?: AbortSignal) =>
        get<GoogleCalendarConnection>("/connections/google-calendar", signal),
      updateCredentials: (input: {
        clientId: string;
        clientSecret?: string;
        redirectUri: string;
      }) =>
        send<GoogleCalendarConnection>("PUT", "/connections/google-calendar/credentials", input),
      oauthStart: () => send<{ url: string }>("POST", "/connections/google-calendar/oauth/start"),
      disconnect: () =>
        send<GoogleCalendarConnection>("POST", "/connections/google-calendar/disconnect"),
    },
  },
  companies: {
    list: (params?: CompanyFilters, signal?: AbortSignal) =>
      get<Paged<Company>>(query("/companies", { ...params }), signal),
    get: (id: string, signal?: AbortSignal) => get<Company>(`/companies/${id}`, signal),
    create: (input: CompanyInput) => send<Company>("POST", "/companies", input),
    update: (id: string, input: CompanyInput) => send<Company>("PATCH", `/companies/${id}`, input),
    industries: (signal?: AbortSignal) => get<{ data: string[] }>("/companies/industries", signal),
    contacts: (id: string, params?: Page, signal?: AbortSignal) =>
      get<Paged<Contact>>(query(`/companies/${id}/contacts`, { ...params }), signal),
    deals: (id: string, params?: Page, signal?: AbortSignal) =>
      get<Paged<Deal>>(query(`/companies/${id}/deals`, { ...params }), signal),
    timeline: (id: string, params?: Page, signal?: AbortSignal) =>
      get<{ data: CrmTimelineEvent[] }>(query(`/companies/${id}/timeline`, { ...params }), signal),
  },
  contacts: {
    list: (params?: ContactFilters, signal?: AbortSignal) =>
      get<Paged<Contact>>(query("/contacts", { ...params }), signal),
    get: (id: string, signal?: AbortSignal) => get<Contact>(`/contacts/${id}`, signal),
    create: (input: ContactInput & { createDeal?: boolean }) =>
      send<Contact>("POST", "/contacts", input),
    update: (id: string, input: ContactInput) => send<Contact>("PATCH", `/contacts/${id}`, input),
    importCsv: (rows: ImportContactRow[]) =>
      send<{ data: ImportContactsResult }>("POST", "/contacts/import", { rows }),
    notes: (id: string, signal?: AbortSignal) =>
      get<{ data: ContactNote[] }>(`/contacts/${id}/notes`, signal),
    addNote: (id: string, body: string, dealId?: string) =>
      send<ContactNote>("POST", `/contacts/${id}/notes`, { body, dealId }),
    markDnc: (id: string, reason: string) =>
      send<Contact>("POST", `/contacts/${id}/dnc`, { reason }),
    reactivateFromDnc: (id: string, reason: string) =>
      send<Contact>("POST", `/contacts/${id}/dnc/reactivate`, { reason }),
    setLifecycle: (id: string, stage: LifecycleStage, note?: string) =>
      send<Contact>("POST", `/contacts/${id}/lifecycle`, { stage, note }),
    /** Merges this contact into the target; returns the target. */
    merge: (id: string, targetContactId: string, reason?: string) =>
      send<Contact>("POST", `/contacts/${id}/merge`, { targetContactId, reason }),
    contactability: (id: string, signal?: AbortSignal) =>
      get<{ data: Contactability[] }>(`/contacts/${id}/contactability`, signal),
    setContactability: (id: string, input: { channel: string; status: string; reason?: string }) =>
      send<{ data: Contactability[] }>("POST", `/contacts/${id}/contactability`, input),
    logCall: (id: string, input: LogCallInput) =>
      send<LogCallResult>("POST", `/contacts/${id}/calls`, input),
    deals: (id: string, params?: Page, signal?: AbortSignal) =>
      get<Paged<Deal>>(query(`/contacts/${id}/deals`, { ...params }), signal),
    calls: (id: string, signal?: AbortSignal) =>
      get<{ data: ContactCall[] }>(`/contacts/${id}/calls`, signal),
    emailActivities: (id: string, signal?: AbortSignal) =>
      get<{ data: EmailActivity[] }>(`/contacts/${id}/email-activities`, signal),
    timeline: (id: string, params?: Page, signal?: AbortSignal) =>
      get<{ data: CrmTimelineEvent[] }>(query(`/contacts/${id}/timeline`, { ...params }), signal),
  },
  deals: {
    list: (params?: DealFilters, signal?: AbortSignal) =>
      get<Paged<Deal>>(query("/deals", { ...params }), signal),
    get: (id: string, signal?: AbortSignal) => get<Deal>(`/deals/${id}`, signal),
    create: (input: { contactId: string; ownerId?: string | null; serviceInterest?: string }) =>
      send<Deal>("POST", "/deals", input),
    update: (
      id: string,
      input: { stage?: PipelineStage; ownerId?: string | null; serviceInterest?: string },
    ) => send<Deal>("PATCH", `/deals/${id}`, input),
    setAutomation: (id: string, mode: AutomationMode, reason?: string) =>
      send<Deal>("POST", `/deals/${id}/automation`, { mode, reason }),
    /** won / discard / nurture / reopen take an optional reason; lost needs a loss reason. */
    setOutcome: (id: string, action: "won" | "discard" | "nurture" | "reopen", reason?: string) =>
      send<Deal>("POST", `/deals/${id}/${action}`, { reason }),
    markLost: (id: string, lossReason: LeadLossReason, notes?: string) =>
      send<Deal>("POST", `/deals/${id}/lost`, { lossReason, notes }),
    tasks: (id: string, signal?: AbortSignal) =>
      get<Paged<Task>>(query(`/deals/${id}/tasks`, { limit: 200 }), signal),
    meetings: (id: string, signal?: AbortSignal) =>
      get<{ data: Meeting[] }>(`/deals/${id}/meetings`, signal),
    proposals: (id: string, signal?: AbortSignal) =>
      get<{ data: Proposal[] }>(`/deals/${id}/proposals`, signal),
    runs: (id: string, signal?: AbortSignal) => get<{ data: Run[] }>(`/deals/${id}/runs`, signal),
    timeline: (id: string, params?: Page, signal?: AbortSignal) =>
      get<{ data: CrmTimelineEvent[] }>(query(`/deals/${id}/timeline`, { ...params }), signal),
  },
  tasks: {
    list: (params?: TaskListParams, signal?: AbortSignal) =>
      get<Paged<Task>>(query("/tasks", params), signal),
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
    uploadDocument: (id: string, file: File) => {
      const formData = new FormData();
      formData.append("document", file);
      return uploadFile<Proposal>(`/proposals/${id}/document`, formData);
    },
    send: (id: string, input: { emailTemplateId?: string; whatsappTemplateId?: string }) =>
      send<Proposal>("POST", `/proposals/${id}/send`, input),
    update: (id: string, input: UpdateProposalInput) =>
      send<Proposal>("PATCH", `/proposals/${id}`, input),
    setStatus: (
      id: string,
      status: ProposalStatus,
      lossReason?: LeadLossReason,
      lossNotes?: string,
    ) => send<Proposal>("POST", `/proposals/${id}/status`, { status, lossReason, lossNotes }),
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
    deleteVersion: (id: string, version: number) =>
      request<Workflow>(`/workflows/${id}/versions/${version}`, { method: "DELETE" }),
  },
  templates: {
    list: (signal?: AbortSignal) => get<{ data: Template[] }>("/templates", signal),
    create: (input: CreateTemplateInput) => send<Template>("POST", "/templates", input),
    update: (id: string, input: UpdateTemplateInput) =>
      send<Template>("PATCH", `/templates/${id}`, input),
    delete: (id: string) => del(`/templates/${id}`),
    uploadAttachment: (templateId: string, file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return uploadFile<TemplateAttachment>(`/templates/${templateId}/attachments`, formData);
    },
    deleteAttachment: (templateId: string, attachmentId: string) =>
      del(`/templates/${templateId}/attachments/${attachmentId}`),
  },
  runs: {
    list: (params?: Record<string, string | undefined>, signal?: AbortSignal) =>
      get<{ data: Run[] }>(query("/runs", params), signal),
    create: (input: { dealId: string; workflowId: string; reason?: string | undefined }) =>
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
