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
