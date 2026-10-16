import type { QueryClient } from "@tanstack/react-query";
import { BackendError } from "@/lib/backend-client";

// Workspace-scoped keys take the current workspace id as their first
// argument and fold it into the key so TanStack Query's cache naturally
// separates data per workspace — switching workspaces changes the key,
// which triggers a fresh fetch instead of momentarily showing the previous
// workspace's cached data. `session`/`profiles`/`workspaces` are
// workspace-agnostic (you need them before a workspace is even selected) and
// stay plain keys.
export const keys = {
  session: ["session"] as const,
  profiles: ["profiles"] as const,
  workspaces: ["workspaces"] as const,
  // Contact lists (any filters) share the prefix ["contacts", ws]; everything on one contact
  // shares ["contact", ws, id], so one invalidation refreshes the whole detail page.
  contacts: (workspaceId: string | null, filters?: object) =>
    filters ? (["contacts", workspaceId, filters] as const) : (["contacts", workspaceId] as const),
  contact: (workspaceId: string | null, id: string, part?: string) =>
    part ? (["contact", workspaceId, id, part] as const) : (["contact", workspaceId, id] as const),
  leads: (workspaceId: string | null) => ["leads", workspaceId] as const,
  lead: (workspaceId: string | null, id: string) => ["lead", workspaceId, id] as const,
  notes: (workspaceId: string | null, id: string) => ["notes", workspaceId, id] as const,
  contactability: (workspaceId: string | null, id: string) =>
    ["contactability", workspaceId, id] as const,
  calls: (workspaceId: string | null, id: string) => ["calls", workspaceId, id] as const,
  timeline: (workspaceId: string | null, id: string) => ["timeline", workspaceId, id] as const,
  tasks: (workspaceId: string | null) => ["tasks", workspaceId] as const,
  meetings: (workspaceId: string | null) => ["meetings", workspaceId] as const,
  proposals: (workspaceId: string | null) => ["proposals", workspaceId] as const,
  workflows: (workspaceId: string | null) => ["workflows", workspaceId] as const,
  templates: (workspaceId: string | null) => ["templates", workspaceId] as const,
  runs: (workspaceId: string | null) => ["runs", workspaceId] as const,
  scheduledActions: (workspaceId: string | null) => ["scheduledActions", workspaceId] as const,
  dashboard: (workspaceId: string | null) => ["dashboard", workspaceId] as const,
  notifications: (workspaceId: string | null) => ["notifications", workspaceId] as const,
};

export function refreshLead(client: QueryClient, workspaceId: string | null, leadId: string) {
  const targets = [
    keys.leads(workspaceId),
    keys.lead(workspaceId, leadId),
    keys.notes(workspaceId, leadId),
    keys.contactability(workspaceId, leadId),
    keys.calls(workspaceId, leadId),
    keys.timeline(workspaceId, leadId),
    keys.tasks(workspaceId),
    keys.meetings(workspaceId),
    keys.proposals(workspaceId),
    keys.runs(workspaceId),
    keys.scheduledActions(workspaceId),
    keys.notifications(workspaceId),
    keys.dashboard(workspaceId),
  ];
  return Promise.all(targets.map((queryKey) => client.invalidateQueries({ queryKey })));
}
export function messageFromError(error: unknown) {
  return error instanceof BackendError || error instanceof Error
    ? error.message
    : "The request failed.";
}
