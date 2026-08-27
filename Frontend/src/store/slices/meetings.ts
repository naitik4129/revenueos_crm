import { useCallback, useMemo, useState } from "react";
import * as seed from "@/mocks/seed";
import type { Meeting } from "@/types";
import { createSliceContext } from "../context";
import type { NextId } from "../ids";
import { NOW } from "@/lib/dates";
import type { TimelineSlice } from "./timeline";

export interface MeetingsSlice {
  meetings: Meeting[];
  addMeeting: (meeting: Omit<Meeting, "id">) => void;
  updateMeeting: (id: string, patch: Partial<Meeting>) => void;
}

export const [MeetingsContext, useMeetings] = createSliceContext<MeetingsSlice>("useMeetings");

export function useMeetingsSlice(
  nid: NextId,
  addTimeline: TimelineSlice["addTimeline"],
  currentUserName: string,
): MeetingsSlice {
  const [meetings, setMeetings] = useState<Meeting[]>(seed.meetings);

  const addMeeting = useCallback(
    (meeting: Omit<Meeting, "id">) => {
      const created: Meeting = { ...meeting, id: nid("mt") };
      setMeetings((prev) => [created, ...prev]);
      addTimeline({
        leadId: meeting.leadId,
        at: NOW,
        kind: "meeting",
        title: "Meeting Scheduled",
        actor: currentUserName,
        source: "Manual",
        detail: meeting.title,
      });
    },
    [nid, addTimeline, currentUserName],
  );

  const updateMeeting = useCallback(
    (id: string, patch: Partial<Meeting>) => {
      setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
      const meeting = meetings.find((m) => m.id === id);
      // Only a status transition is timeline-worthy; editing notes is not.
      if (meeting && patch.status) {
        addTimeline({
          leadId: meeting.leadId,
          at: NOW,
          kind: "meeting",
          title: patch.status === "Completed" ? "Meeting Completed" : `Meeting ${patch.status}`,
          actor: currentUserName,
          source: "Manual",
          detail: patch.outcome ? `Outcome: ${patch.outcome}` : undefined,
        });
      }
    },
    [meetings, addTimeline, currentUserName],
  );

  return useMemo(
    () => ({ meetings, addMeeting, updateMeeting }),
    [meetings, addMeeting, updateMeeting],
  );
}
