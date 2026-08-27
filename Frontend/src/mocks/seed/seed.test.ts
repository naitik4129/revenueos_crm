import { describe, expect, it } from "vitest";
import * as seed from "@/mocks/seed";

const collectionSizes = {
  leads: 14,
  timeline: 40,
  tasks: 14,
  meetings: 8,
  proposals: 5,
  workflows: 5,
  runs: 9,
  templates: 6,
  notifications: 5,
  users: 4,
} as const;

describe("mock seed", () => {
  it("keeps the approved prototype clock and collection sizes", () => {
    expect(seed.TODAY).toBe("2026-08-26");
    for (const [name, size] of Object.entries(collectionSizes)) {
      expect(seed[name as keyof typeof collectionSizes]).toHaveLength(size);
    }
  });

  it("uses unique IDs within every record collection", () => {
    for (const name of Object.keys(collectionSizes)) {
      const records = seed[name as keyof typeof collectionSizes];
      const ids = records.map((record) => record.id);
      expect(new Set(ids).size, `${name} contains duplicate IDs`).toBe(ids.length);
    }
  });

  it("keeps all mock relationships valid", () => {
    const leadIds = new Set(seed.leads.map((lead) => lead.id));
    const userIds = new Set(seed.users.map((user) => user.id));
    const workflowIds = new Set(seed.workflows.map((workflow) => workflow.id));

    expect(userIds.has(seed.currentUserId)).toBe(true);
    expect(seed.leads.every((lead) => userIds.has(lead.ownerId))).toBe(true);
    expect(seed.tasks.every((task) => leadIds.has(task.leadId) && userIds.has(task.ownerId))).toBe(
      true,
    );
    expect(
      seed.meetings.every((meeting) => leadIds.has(meeting.leadId) && userIds.has(meeting.ownerId)),
    ).toBe(true);
    expect(
      seed.proposals.every(
        (proposal) => leadIds.has(proposal.leadId) && userIds.has(proposal.ownerId),
      ),
    ).toBe(true);
    expect(seed.timeline.every((event) => leadIds.has(event.leadId))).toBe(true);
    expect(
      seed.runs.every((run) => leadIds.has(run.leadId) && workflowIds.has(run.workflowId)),
    ).toBe(true);
  });
});
