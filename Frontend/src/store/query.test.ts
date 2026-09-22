import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { keys, refreshLead } from "./query";

describe("query invalidation", () => {
  it("refreshes every lead-dependent aggregate after a composite mutation", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();

    await refreshLead(client, "workspace-1", "lead-1");

    const invalidated = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(invalidated).toEqual(
      expect.arrayContaining([
        keys.leads("workspace-1"),
        keys.lead("workspace-1", "lead-1"),
        keys.notes("workspace-1", "lead-1"),
        keys.contactability("workspace-1", "lead-1"),
        keys.calls("workspace-1", "lead-1"),
        keys.timeline("workspace-1", "lead-1"),
        keys.tasks("workspace-1"),
        keys.meetings("workspace-1"),
        keys.proposals("workspace-1"),
        keys.runs("workspace-1"),
        keys.scheduledActions("workspace-1"),
        keys.notifications("workspace-1"),
        keys.dashboard("workspace-1"),
      ]),
    );
  });

  it("keys every workspace-scoped query by the workspace id so switching workspaces changes the cache key", () => {
    expect(keys.leads("workspace-1")).not.toEqual(keys.leads("workspace-2"));
    expect(keys.leads(null)).toEqual(["leads", null]);
  });
});
