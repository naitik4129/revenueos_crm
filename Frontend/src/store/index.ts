export { StoreProvider } from "./store-provider";
export {
  useSession,
  useTasks,
  useTaskTotals,
  useMeetings,
  useProposals,
  useProposalSummary,
  useRuns,
  useScheduledActions,
  useAutomations,
  useNotifications,
  useTemplateVariables,
  useDashboard,
} from "./server-hooks";
export { messageFromError } from "./query";
export {
  useContacts,
  useContactSearch,
  useCompanySearch,
  useContactDetail,
  useCompanies,
  useCompanyDetail,
  useIndustries,
  useDeals,
  useDeal,
  useDealDetail,
  useCrmMutation,
} from "./contact-hooks";
export type {
  SessionSlice,
  TasksSlice,
  MeetingsSlice,
  ProposalsSlice,
  AutomationsSlice,
  NotificationsSlice,
} from "./server-hooks";
