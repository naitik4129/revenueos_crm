import { useCallback, useMemo, useState } from "react";
import * as seed from "@/mocks/seed";
import type { TimelineEvent } from "@/types";
import { createSliceContext } from "../context";
import type { NextId } from "../ids";

export interface TimelineSlice {
  timeline: TimelineEvent[];
  addTimeline: (event: Omit<TimelineEvent, "id">) => void;
}

export const [TimelineContext, useTimeline] = createSliceContext<TimelineSlice>("useTimeline");

/**
 * The audit log every other slice writes to. Kept separate so a write from
 * any domain lands in one chronological feed.
 */
export function useTimelineSlice(nid: NextId): TimelineSlice {
  const [timeline, setTimeline] = useState<TimelineEvent[]>(seed.timeline);

  const addTimeline = useCallback(
    (event: Omit<TimelineEvent, "id">) => {
      // The id is minted outside the updater: state updaters must be pure,
      // and React invokes them twice under StrictMode.
      const entry: TimelineEvent = { ...event, id: nid("e") };
      setTimeline((prev) => [...prev, entry]);
    },
    [nid],
  );

  return useMemo(() => ({ timeline, addTimeline }), [timeline, addTimeline]);
}
