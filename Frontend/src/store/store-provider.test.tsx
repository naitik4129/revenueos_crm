import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  StoreProvider,
  useAutomations,
  useLeads,
  useMeetings,
  useNotifications,
  useProposals,
  useSession,
  useTasks,
  useTimeline,
} from "@/store";
import { NOW } from "@/lib/dates";

function wrapper({ children }: { children: ReactNode }) {
  return <StoreProvider>{children}</StoreProvider>;
}

function useApplicationState() {
  return {
    automations: useAutomations(),
    leads: useLeads(),
    meetings: useMeetings(),
    notifications: useNotifications(),
    proposals: useProposals(),
    session: useSession(),
    tasks: useTasks(),
    timeline: useTimeline(),
  };
}

describe("StoreProvider", () => {
  it("creates a lead, note and audit history through focused domain hooks", () => {
    const { result } = renderHook(useApplicationState, { wrapper });
    const leadCount = result.current.leads.leads.length;
    const eventCount = result.current.timeline.timeline.length;
    let leadId = "";

    act(() => {
      leadId = result.current.leads.addLead({
        firstName: "Test",
        lastName: "Lead",
        company: "Northbeam QA",
        email: "test@example.com",
      });
    });

    expect(result.current.leads.leads).toHaveLength(leadCount + 1);
    expect(result.current.leads.getLead(leadId)?.company).toBe("Northbeam QA");
    expect(result.current.timeline.timeline).toHaveLength(eventCount + 2);

    act(() => result.current.leads.addNote(leadId, "Ready for backend integration"));

    expect(result.current.leads.getLead(leadId)?.notes.at(-1)?.body).toBe(
      "Ready for backend integration",
    );
    expect(result.current.timeline.timeline.at(-1)?.title).toBe("Note Added");
  });

  it("synchronizes automation runs when a lead is paused or marked DNC", () => {
    const { result } = renderHook(useApplicationState, { wrapper });
    const run = result.current.automations.runs.find((item) =>
      ["Running", "Waiting", "Paused"].includes(item.status),
    );
    expect(run).toBeDefined();
    if (!run) return;

    act(() => result.current.leads.setAutomation(run.leadId, "Paused", "Manager review"));
    expect(
      result.current.automations.runs
        .filter((item) => item.leadId === run.leadId && item.status !== "Completed")
        .every((item) => item.status === "Paused"),
    ).toBe(true);

    act(() => result.current.leads.markDnc(run.leadId, "Customer requested"));
    expect(result.current.leads.getLead(run.leadId)).toMatchObject({
      doNotContact: true,
      automation: "Stopped",
      nextAction: null,
    });
    expect(
      result.current.automations.runs
        .filter((item) => item.leadId === run.leadId && item.status !== "Completed")
        .every((item) => item.status === "Cancelled"),
    ).toBe(true);
  });

  it("records task, meeting and proposal state transitions", () => {
    const { result } = renderHook(useApplicationState, { wrapper });
    const task = result.current.tasks.tasks.find((item) => !item.done);
    const meeting = result.current.meetings.meetings[0];
    const proposal = result.current.proposals.proposals[0];
    expect(task).toBeDefined();
    expect(meeting).toBeDefined();
    expect(proposal).toBeDefined();
    if (!task || !meeting || !proposal) return;

    act(() => result.current.tasks.toggleTask(task.id));
    expect(result.current.tasks.tasks.find((item) => item.id === task.id)?.done).toBe(true);
    expect(result.current.timeline.timeline.at(-1)?.title).toBe("Task Completed");

    act(() =>
      result.current.meetings.updateMeeting(meeting.id, {
        status: "Completed",
        outcome: "Proposal Required",
      }),
    );
    expect(result.current.meetings.meetings.find((item) => item.id === meeting.id)?.status).toBe(
      "Completed",
    );

    act(() => result.current.proposals.updateProposal(proposal.id, { status: "Accepted" }));
    expect(
      result.current.proposals.proposals.find((item) => item.id === proposal.id),
    ).toMatchObject({ status: "Accepted", updatedAt: NOW });
  });

  it("creates and publishes workflow drafts and reads notifications", () => {
    const { result } = renderHook(useApplicationState, { wrapper });
    const workflow = result.current.automations.workflows[0];
    expect(workflow).toBeDefined();
    if (!workflow) return;
    let version = 0;

    act(() => {
      version = result.current.automations.createDraft(workflow.id);
    });
    expect(version).toBeGreaterThan(workflow.currentVersion);

    act(() => result.current.automations.publishVersion(workflow.id, version));
    expect(
      result.current.automations.workflows.find((item) => item.id === workflow.id),
    ).toMatchObject({ currentVersion: version });

    act(() => result.current.notifications.markNotificationsRead());
    expect(result.current.notifications.notifications.every((item) => item.read)).toBe(true);
  });
});
