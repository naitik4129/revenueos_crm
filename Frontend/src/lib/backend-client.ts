import { supabase } from "./supabase-client";

// Typed client for the real Backend/ service (see Backend/README.md for the
// full route list and error shape). NOT wired into any store slice yet —
// this is the ready-to-use integration seam for the next incremental step
// described in the implementation report ("Frontend integration").
//
// Deliberately uses the backend's actual contract (camelCase keys, the new
// lowercase-snake pipeline/lifecycle vocabulary from the Supabase
// migration) rather than force-fitting the older mock `src/types` shapes —
// see the implementation report for why those two vocabularies currently
// differ and what the follow-up migration step looks like.

const BASE_URL =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "http://localhost:8787";

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

async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, method?: string, body?: unknown): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeader()),
  };
  const init: RequestInit = {
    headers,
    ...(method ? { method } : {}),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`${BASE_URL}/api/v1${path}`, init);
  const responseBody = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = responseBody?.error ?? { code: "unknown", message: res.statusText };
    throw new BackendError(res.status, err.code, err.message, err.details);
  }
  return responseBody as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, "POST", body);
const patchRequest = <T>(path: string, body?: unknown) => request<T>(path, "PATCH", body);
const put = <T>(path: string, body?: unknown) => request<T>(path, "PUT", body);

export interface BackendLead {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  industry: string;
  email: string;
  phone: string;
  source: string;
  serviceInterest: string;
  ownerId?: string;
  ownerName?: string;
  pipelineStage: string;
  lifecycleState: string;
  automationMode: string;
  responseState: string;
  doNotContact: boolean;
  dncReason?: string;
  dncBy?: string;
  dncAt?: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  nextAction: {
    taskId: string;
    type: string;
    title: string;
    dueAt: string;
    ownerId?: string;
    ownerName?: string;
  } | null;
}

export const backend = {
  me: () => get<{ id: string; name: string; email: string }>("/me"),
  profiles: () =>
    get<{ data: { id: string; name: string; email: string; initials: string; active: boolean }[] }>(
      "/profiles",
    ),

  leads: {
    list: (params?: Record<string, string>) =>
      get<{ data: BackendLead[] }>(`/leads${params ? `?${new URLSearchParams(params)}` : ""}`),
    get: (id: string) => get<BackendLead>(`/leads/${id}`),
    create: (input: Record<string, unknown>) => post<BackendLead>("/leads", input),
    update: (id: string, fields: Record<string, unknown>) =>
      patchRequest<BackendLead>(`/leads/${id}`, fields),
    addNote: (id: string, body: string) => post(`/leads/${id}/notes`, { body }),
    notes: (id: string) =>
      get<{ data: { id: string; author: string; body: string; at: string }[] }>(
        `/leads/${id}/notes`,
      ),
    setAutomation: (id: string, mode: string, reason?: string) =>
      post<BackendLead>(`/leads/${id}/automation`, { mode, reason }),
    markDnc: (id: string, reason: string) => post<BackendLead>(`/leads/${id}/dnc`, { reason }),
    reactivateFromDnc: (id: string, reason: string) =>
      post<BackendLead>(`/leads/${id}/dnc/reactivate`, { reason }),
    markWon: (id: string, reason?: string) => post<BackendLead>(`/leads/${id}/won`, { reason }),
    markLost: (id: string, reason?: string) => post<BackendLead>(`/leads/${id}/lost`, { reason }),
    discard: (id: string, reason?: string) => post<BackendLead>(`/leads/${id}/discard`, { reason }),
    reactivate: (id: string, reason?: string) =>
      post<BackendLead>(`/leads/${id}/reactivate`, { reason }),
    logCall: (id: string, input: Record<string, unknown>) =>
      post<{ call: unknown; lead: BackendLead }>(`/leads/${id}/calls`, input),
    calls: (id: string) => get<{ data: unknown[] }>(`/leads/${id}/calls`),
    timeline: (id: string) => get<{ data: unknown[] }>(`/leads/${id}/timeline`),
    meetings: (id: string) => get<{ data: unknown[] }>(`/leads/${id}/meetings`),
    proposals: (id: string) => get<{ data: unknown[] }>(`/leads/${id}/proposals`),
    runs: (id: string) => get<{ data: unknown[] }>(`/leads/${id}/runs`),
  },

  tasks: {
    list: (params?: Record<string, string>) =>
      get<{ data: unknown[] }>(`/tasks${params ? `?${new URLSearchParams(params)}` : ""}`),
    create: (input: Record<string, unknown>) => post("/tasks", input),
    complete: (id: string) => post(`/tasks/${id}/complete`),
    cancel: (id: string, reason?: string) => post(`/tasks/${id}/cancel`, { reason }),
  },

  meetings: {
    list: (params?: Record<string, string>) =>
      get<{ data: unknown[] }>(`/meetings${params ? `?${new URLSearchParams(params)}` : ""}`),
    create: (input: Record<string, unknown>) => post("/meetings", input),
    update: (id: string, fields: Record<string, unknown>) =>
      patchRequest(`/meetings/${id}`, fields),
    recordOutcome: (id: string, outcome: string, notes?: string) =>
      post(`/meetings/${id}/outcome`, { outcome, notes }),
  },

  proposals: {
    list: (params?: Record<string, string>) =>
      get<{ data: unknown[] }>(`/proposals${params ? `?${new URLSearchParams(params)}` : ""}`),
    create: (input: Record<string, unknown>) => post("/proposals", input),
    update: (id: string, fields: Record<string, unknown>) =>
      patchRequest(`/proposals/${id}`, fields),
    setStatus: (id: string, status: string) => post(`/proposals/${id}/status`, { status }),
  },

  workflows: {
    list: () => get<{ data: unknown[] }>("/workflows"),
    get: (id: string) => get(`/workflows/${id}`),
    createDraft: (id: string) => post(`/workflows/${id}/draft`),
    updateSteps: (id: string, version: number, steps: unknown[]) =>
      put(`/workflows/${id}/versions/${version}/steps`, { steps }),
    publish: (id: string, version: number) =>
      post(`/workflows/${id}/versions/${version}/publish`, { enrollmentMode: "keep_existing" }),
  },

  templates: {
    list: () => get<{ data: unknown[] }>("/templates"),
  },

  runs: {
    list: (params?: Record<string, string>) =>
      get<{ data: unknown[] }>(`/runs${params ? `?${new URLSearchParams(params)}` : ""}`),
    pause: (id: string, reason?: string) => post(`/runs/${id}/pause`, { reason }),
    resume: (id: string) => post(`/runs/${id}/resume`),
    cancel: (id: string, reason?: string) => post(`/runs/${id}/cancel`, { reason }),
    retry: (id: string) => post(`/runs/${id}/retry`),
  },

  dashboard: {
    summary: () => get("/dashboard/summary"),
  },

  notifications: {
    list: () => get<{ data: unknown[] }>("/notifications"),
    markRead: (id: string) => post(`/notifications/${id}/read`),
  },
};
