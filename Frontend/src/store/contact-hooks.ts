import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend, type ContactFilters } from "@/lib/backend-client";
import { keys } from "./query";
import { useWorkspace } from "./workspace-context";

export function useContacts(filters: ContactFilters) {
  const { currentWorkspaceId } = useWorkspace();
  return useQuery({
    queryKey: keys.contacts(currentWorkspaceId, filters),
    queryFn: ({ signal }) => backend.contacts.list(filters, signal),
    enabled: Boolean(currentWorkspaceId),
    placeholderData: (previous) => previous,
  });
}

/** Header search: the first few contacts matching `search` (empty = no request). */
export function useContactSearch(search: string) {
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: keys.contacts(currentWorkspaceId, { search, limit: 6 }),
    queryFn: ({ signal }) => backend.contacts.list({ search, limit: 6 }, signal),
    enabled: Boolean(currentWorkspaceId) && search.length > 0,
    placeholderData: (previous) => previous,
  });
  return { results: search ? (query.data?.data ?? []) : [], isFetching: query.isFetching };
}

/** One contact and everything shown on its detail page. */
export function useContactDetail(id: string) {
  const { currentWorkspaceId: ws } = useWorkspace();
  const opts = <T>(part: string, fn: (signal: AbortSignal) => Promise<T>) => ({
    queryKey: keys.contact(ws, id, part),
    queryFn: ({ signal }: { signal: AbortSignal }) => fn(signal),
    enabled: Boolean(ws),
  });
  return {
    contact: useQuery(opts("contact", (s) => backend.contacts.get(id, s))),
    deals: useQuery(opts("deals", (s) => backend.contacts.deals(id, { limit: 50 }, s))),
    calls: useQuery(opts("calls", (s) => backend.contacts.calls(id, s))),
    emails: useQuery(opts("emails", (s) => backend.contacts.emailActivities(id, s))),
    timeline: useQuery(opts("timeline", (s) => backend.contacts.timeline(id, { limit: 100 }, s))),
    notes: useQuery(opts("notes", (s) => backend.contacts.notes(id, s))),
    channels: useQuery(opts("channels", (s) => backend.contacts.contactability(id, s))),
  };
}

/**
 * Wraps a contact write: afterwards refreshes that contact's detail, contact lists and the
 * dashboard (a call or DNC can change lifecycle, deals and tasks).
 */
export function useContactMutation<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  const { currentWorkspaceId: ws } = useWorkspace();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all(
        [["contact", ws], keys.contacts(ws), keys.dashboard(ws), keys.tasks(ws)].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}
