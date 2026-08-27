import type { QueryClient } from "@tanstack/react-query";
import { BackendError } from "@/lib/backend-client";

export const keys = {
  session: ["session"] as const,
  profiles: ["profiles"] as const,
  leads: ["leads"] as const,
  lead: (id: string) => ["lead", id] as const,
  notes: (id: string) => ["notes", id] as const,
  contactability: (id: string) => ["contactability", id] as const,
  calls: (id: string) => ["calls", id] as const,
  timeline: (id: string) => ["timeline", id] as const,
  tasks: ["tasks"] as const,
  meetings: ["meetings"] as const,
  proposals: ["proposals"] as const,
  workflows: ["workflows"] as const,
  templates: ["templates"] as const,
  runs: ["runs"] as const,
  scheduledActions: ["scheduledActions"] as const,
  dashboard: ["dashboard"] as const,
  notifications: ["notifications"] as const,
};

export function refreshLead(client: QueryClient, leadId: string) {
  const targets = [
    keys.leads,
    keys.lead(leadId),
    keys.notes(leadId),
    keys.contactability(leadId),
    keys.calls(leadId),
    keys.timeline(leadId),
    keys.tasks,
    keys.meetings,
    keys.proposals,
    keys.runs,
    keys.scheduledActions,
    keys.notifications,
    keys.dashboard,
  ];
  return Promise.all(targets.map((queryKey) => client.invalidateQueries({ queryKey })));
}
export function messageFromError(error: unknown) {
  return error instanceof BackendError || error instanceof Error
    ? error.message
    : "The request failed.";
}
