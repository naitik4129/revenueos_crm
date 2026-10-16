export { StoreProvider } from "./store-provider";
export {
  useSession,
  useLeads,
  useLead,
  useTasks,
  useMeetings,
  useProposals,
  useTimeline,
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
  useCrmMutation,
} from "./contact-hooks";
export type {
  SessionSlice,
  LeadsSlice,
  TasksSlice,
  MeetingsSlice,
  ProposalsSlice,
  TimelineSlice,
  AutomationsSlice,
  NotificationsSlice,
} from "./server-hooks";
