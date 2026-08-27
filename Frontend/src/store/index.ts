// Public surface of the app store. Components import the domain hook they
// need — never a slice's internals.
//
// Backend swap point: each `use*Slice` in ./slices seeds itself from
// src/mocks/seed. Replacing one with a React Query hook against the API
// changes only that file; the hooks below keep the same shape, so no
// component has to change.
export { StoreProvider } from "./store-provider";

export { useAutomations, type AutomationsSlice } from "./slices/automations";
export { useLeads, type LeadsSlice } from "./slices/leads";
export { useMeetings, type MeetingsSlice } from "./slices/meetings";
export { useNotifications, type NotificationsSlice } from "./slices/notifications";
export { useProposals, type ProposalsSlice } from "./slices/proposals";
export { useSession, type SessionSlice } from "./slices/session";
export { useTasks, type TasksSlice } from "./slices/tasks";
export { useTimeline, type TimelineSlice } from "./slices/timeline";
