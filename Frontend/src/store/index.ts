export { StoreProvider } from "./store-provider";
export {
  useSession,
  useTasks,
  useTaskTotals,
  useMeetings,
  useProposals,
  useAutomations,
  useNotifications,
  useDashboard,
} from "./server-hooks";
export { messageFromError } from "./query";
export {
  useContacts,
  useContactSearch,
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
