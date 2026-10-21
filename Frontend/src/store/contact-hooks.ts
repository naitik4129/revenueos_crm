import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PipelineStage, Proposal } from "@/types";
import {
  backend,
  type BoardFilters,
  type CompanyFilters,
  type ContactFilters,
  type DealFilters,
} from "@/lib/backend-client";
import { keys, refreshCrm } from "./query";
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

/** Header search: the first few companies matching `search` (empty = no request). */
export function useCompanySearch(search: string) {
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: keys.companies(currentWorkspaceId, { search, limit: 4 }),
    queryFn: ({ signal }) => backend.companies.list({ search, limit: 4 }, signal),
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
  // The company card and the open deal's meetings come in one request keyed by the contact,
  // so nothing waits for the contact first (two queries share it through `select`).
  const related = opts("related", (s) => backend.contacts.related(id, s));
  return {
    contact: useQuery(opts("contact", (s) => backend.contacts.get(id, s))),
    company: useQuery({ ...related, select: (r) => r.company }),
    meetings: useQuery({ ...related, select: (r) => ({ data: r.openDealMeetings }) }),
    deals: useQuery(opts("deals", (s) => backend.contacts.deals(id, { limit: 50 }, s))),
    calls: useQuery(opts("calls", (s) => backend.contacts.calls(id, s))),
    emails: useQuery(opts("emails", (s) => backend.contacts.emailActivities(id, s))),
    timeline: useQuery(opts("timeline", (s) => backend.contacts.timeline(id, { limit: 100 }, s))),
    notes: useQuery(opts("notes", (s) => backend.contacts.notes(id, s))),
    channels: useQuery(opts("channels", (s) => backend.contacts.contactability(id, s))),
    tasks: useQuery(
      opts("tasks", (s) => backend.tasks.list({ contactId: id, status: "open", limit: 20 }, s)),
    ),
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
  // Open tasks on the company's deals and contacts, soonest first (one page of 200).
  const tasks = useQuery({
    ...opts("tasks", (s) => backend.tasks.list({ companyId: id, status: "open", limit: 200 }, s)),
    select: (r) => r.data,
  });
  return {
    company: useQuery(opts("company", (s) => backend.companies.get(id, s))),
    contacts: useQuery(opts("contacts", (s) => backend.companies.contacts(id, { limit: 200 }, s))),
    deals: useQuery(opts("deals", (s) => backend.companies.deals(id, { limit: 200 }, s))),
    tasks,
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

/** The board in one request: count + amount per stage (all open deals) and each stage's first deals. */
export function useDealBoardSummary(filters: BoardFilters, perStage: number) {
  const { currentWorkspaceId } = useWorkspace();
  return useQuery({
    queryKey: keys.deals(currentWorkspaceId, { boardSummary: filters, perStage }),
    queryFn: ({ signal }) => backend.deals.boardSummary({ ...filters, perStage }, signal),
    enabled: Boolean(currentWorkspaceId),
    placeholderData: (previous) => previous,
  });
}

/**
 * One board column's deals after the first page (which comes with the board summary): off until
 * the first "load more", then a page at a time (fetchNextPage).
 */
export function useDealColumn(
  filters: BoardFilters,
  stage: PipelineStage,
  pageSize: number,
  enabled: boolean,
) {
  const { currentWorkspaceId } = useWorkspace();
  return useInfiniteQuery({
    queryKey: keys.deals(currentWorkspaceId, { boardColumn: stage, pageSize, ...filters }),
    queryFn: ({ pageParam, signal }) =>
      backend.deals.list(
        { ...filters, outcome: "open", stage, limit: pageSize, offset: pageParam },
        signal,
      ),
    initialPageParam: pageSize,
    getNextPageParam: (last) =>
      last.offset + last.data.length < last.total ? last.offset + last.data.length : undefined,
    enabled: Boolean(currentWorkspaceId) && enabled,
  });
}

/** One deal and everything shown on its page (notes are the contact's, filtered to the deal). */
export function useDealDetail(id: string) {
  const { currentWorkspaceId: ws } = useWorkspace();
  const opts = <T>(part: string, fn: (signal: AbortSignal) => Promise<T>) => ({
    queryKey: keys.deal(ws, id, part),
    queryFn: ({ signal }: { signal: AbortSignal }) => fn(signal),
    enabled: Boolean(ws),
  });
  // Contact, notes and company in one request keyed by the deal, so nothing waits for the deal.
  const related = opts("related", (s) => backend.deals.related(id, s));
  return {
    tasks: useQuery(opts("tasks", (s) => backend.deals.tasks(id, s))),
    meetings: useQuery(opts("meetings", (s) => backend.deals.meetings(id, s))),
    proposals: useQuery({
      ...opts("proposals", (s) => backend.deals.proposals(id, s)),
      // WhatsApp sends finish on the worker a few seconds later.
      refetchInterval: (q: { state: { data?: { data: Proposal[] } | undefined } }) =>
        q.state.data?.data.some((p) => ["queued", "sending"].includes(p.whatsappSendStatus))
          ? 8000
          : false,
    }),
    runs: useQuery(opts("runs", (s) => backend.deals.runs(id, s))),
    // Deal-filtered; one deal has a handful of actions, so one page of 500 is all of them.
    scheduledActions: useQuery(
      opts("scheduledActions", (s) => backend.scheduledActions.list({ dealId: id, limit: 500 }, s)),
    ),
    timeline: useQuery(opts("timeline", (s) => backend.deals.timeline(id, { limit: 100 }, s))),
    contact: useQuery({ ...related, select: (r) => r.contact }),
    notes: useQuery({ ...related, select: (r) => ({ data: r.notes }) }),
    company: useQuery({ ...related, select: (r) => r.company }),
  };
}

export function useDeal(id: string) {
  const { currentWorkspaceId } = useWorkspace();
  return useQuery({
    queryKey: keys.deal(currentWorkspaceId, id),
    queryFn: ({ signal }) => backend.deals.get(id, signal),
    enabled: Boolean(currentWorkspaceId),
  });
}

/** Wraps any CRM write; afterwards refreshes everything it can touch (see refreshCrm). */
export function useCrmMutation<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  const { currentWorkspaceId } = useWorkspace();
  return useMutation({ mutationFn: fn, onSuccess: () => refreshCrm(client, currentWorkspaceId) });
}
