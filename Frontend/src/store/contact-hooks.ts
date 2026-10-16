import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  backend,
  type CompanyFilters,
  type ContactFilters,
  type DealFilters,
} from "@/lib/backend-client";
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

export function useCompanies(filters: CompanyFilters) {
  const { currentWorkspaceId } = useWorkspace();
  return useQuery({
    queryKey: keys.companies(currentWorkspaceId, filters),
    queryFn: ({ signal }) => backend.companies.list(filters, signal),
    enabled: Boolean(currentWorkspaceId),
    placeholderData: (previous) => previous,
  });
}

/** Distinct industries in the workspace, for the companies filter. */
export function useIndustries() {
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: keys.companies(currentWorkspaceId, { industries: true }),
    queryFn: ({ signal }) => backend.companies.industries(signal),
    enabled: Boolean(currentWorkspaceId),
  });
  return query.data?.data ?? [];
}

/** One company and everything shown on its detail page. */
export function useCompanyDetail(id: string) {
  const { currentWorkspaceId: ws } = useWorkspace();
  const opts = <T>(part: string, fn: (signal: AbortSignal) => Promise<T>) => ({
    queryKey: keys.company(ws, id, part),
    queryFn: ({ signal }: { signal: AbortSignal }) => fn(signal),
    enabled: Boolean(ws),
  });
  return {
    company: useQuery(opts("company", (s) => backend.companies.get(id, s))),
    contacts: useQuery(opts("contacts", (s) => backend.companies.contacts(id, { limit: 200 }, s))),
    deals: useQuery(opts("deals", (s) => backend.companies.deals(id, { limit: 200 }, s))),
    timeline: useQuery(opts("timeline", (s) => backend.companies.timeline(id, { limit: 100 }, s))),
  };
}

export function useDeals(filters: DealFilters) {
  const { currentWorkspaceId } = useWorkspace();
  return useQuery({
    queryKey: keys.deals(currentWorkspaceId, filters),
    queryFn: ({ signal }) => backend.deals.list(filters, signal),
    enabled: Boolean(currentWorkspaceId),
    placeholderData: (previous) => previous,
  });
}

export function useDeal(id: string) {
  const { currentWorkspaceId } = useWorkspace();
  return useQuery({
    queryKey: keys.deal(currentWorkspaceId, id),
    queryFn: ({ signal }) => backend.deals.get(id, signal),
    enabled: Boolean(currentWorkspaceId),
  });
}

/**
 * Wraps a contact, company or deal write: afterwards refreshes contact, company and deal lists
 * and detail pages, the dashboard and tasks (a call or DNC can change lifecycle, deals and tasks; a
 * contact edit changes its company's contact list).
 */
export function useCrmMutation<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  const { currentWorkspaceId: ws } = useWorkspace();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all(
        [
          ["contact", ws],
          keys.contacts(ws),
          ["company", ws],
          keys.companies(ws),
          ["deal", ws],
          keys.deals(ws),
          keys.dashboard(ws),
          keys.tasks(ws),
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}
