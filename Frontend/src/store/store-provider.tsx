import type { ReactNode } from "react";
import { useIdFactory } from "./ids";
import { AutomationsContext, useAutomationsSlice } from "./slices/automations";
import { LeadsContext, useLeadsSlice } from "./slices/leads";
import { MeetingsContext, useMeetingsSlice } from "./slices/meetings";
import { NotificationsContext, useNotificationsSlice } from "./slices/notifications";
import { ProposalsContext, useProposalsSlice } from "./slices/proposals";
import { SessionContext, useSessionSlice } from "./slices/session";
import { TasksContext, useTasksSlice } from "./slices/tasks";
import { TimelineContext, useTimelineSlice } from "./slices/timeline";

/**
 * Application state for the prototype: in-memory, seeded from src/mocks/seed,
 * and reset on reload.
 *
 * Slices are constructed in dependency order — the timeline is written to by
 * every domain, and lead automation changes have to reach in-flight runs.
 * Each slice publishes its own context so an unrelated update does not
 * re-render every consumer.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const nid = useIdFactory();

  const session = useSessionSlice();
  const currentUserName = session.currentUser.name;

  const timeline = useTimelineSlice(nid);
  const { runEffects, ...automations } = useAutomationsSlice(nid, currentUserName);

  const leads = useLeadsSlice({
    nid,
    addTimeline: timeline.addTimeline,
    runEffects,
    currentUserName,
    userName: session.userName,
  });
  const tasks = useTasksSlice(nid, timeline.addTimeline, currentUserName);
  const meetings = useMeetingsSlice(nid, timeline.addTimeline, currentUserName);
  const proposals = useProposalsSlice(nid, timeline.addTimeline, currentUserName);
  const notifications = useNotificationsSlice();

  return (
    <SessionContext.Provider value={session}>
      <TimelineContext.Provider value={timeline}>
        <AutomationsContext.Provider value={automations}>
          <LeadsContext.Provider value={leads}>
            <TasksContext.Provider value={tasks}>
              <MeetingsContext.Provider value={meetings}>
                <ProposalsContext.Provider value={proposals}>
                  <NotificationsContext.Provider value={notifications}>
                    {children}
                  </NotificationsContext.Provider>
                </ProposalsContext.Provider>
              </MeetingsContext.Provider>
            </TasksContext.Provider>
          </LeadsContext.Provider>
        </AutomationsContext.Provider>
      </TimelineContext.Provider>
    </SessionContext.Provider>
  );
}
