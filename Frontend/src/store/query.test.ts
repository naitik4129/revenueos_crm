import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { keys, refreshLead } from "./query";

describe("query invalidation", () => {
  it("refreshes every lead-dependent aggregate after a composite mutation", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();

    await refreshLead(client, "lead-1");

    const invalidated = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(invalidated).toEqual(
      expect.arrayContaining([
        keys.leads,
        keys.lead("lead-1"),
        keys.notes("lead-1"),
        keys.contactability("lead-1"),
        keys.calls("lead-1"),
        keys.timeline("lead-1"),
        keys.tasks,
        keys.meetings,
        keys.proposals,
        keys.runs,
        keys.scheduledActions,
        keys.notifications,
        keys.dashboard,
      ]),
    );
  });
});
