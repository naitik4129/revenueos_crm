import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { keys, refreshCrm } from "./query";

describe("query invalidation", () => {
  it("refreshes every workspace aggregate after a CRM write", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();

    await refreshCrm(client, "workspace-1");

    const invalidated = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(invalidated).toEqual(
      expect.arrayContaining([
        ["contact", "workspace-1"],
        ["company", "workspace-1"],
        ["deal", "workspace-1"],
        keys.deals("workspace-1"),
        keys.tasks("workspace-1"),
        keys.meetings("workspace-1"),
        keys.proposals("workspace-1"),
        keys.runs("workspace-1"),
        keys.scheduledActions("workspace-1"),
        keys.notifications("workspace-1"),
        keys.dashboard("workspace-1"),
      ]),
    );
    // Only this workspace.
    expect(invalidated.every((key) => key?.[1] === "workspace-1")).toBe(true);
  });

  it("keys every workspace-scoped query by the workspace id so switching workspaces changes the cache key", () => {
    expect(keys.deals("workspace-1")).not.toEqual(keys.deals("workspace-2"));
    expect(keys.deal(null, "d1", "tasks")).toEqual(["deal", null, "d1", "tasks"]);
  });
});
