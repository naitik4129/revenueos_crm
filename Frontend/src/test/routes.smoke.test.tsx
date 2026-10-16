import { cleanup, render } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store", () => {
  const noop = vi.fn(async () => undefined);
  return {
    messageFromError: (error: unknown) =>
      error instanceof Error ? error.message : "Request failed",
    useSession: () => ({
      users: [],
      currentUser: null,
      userName: () => "Unassigned",
      isLoading: false,
      error: null,
    }),
    useLeads: () => ({
      leads: [],
      getLead: () => undefined,
      isLoading: false,
      error: null,
      isPending: false,
      addLead: noop,
      updateLead: noop,
      addNote: noop,
      setAutomation: noop,
      markDnc: noop,
      reactivateFromDnc: noop,
      logCall: noop,
      logCommunication: noop,
      setLifecycle: noop,
    }),
    useContacts: () => ({
      data: { data: [], total: 0, limit: 50, offset: 0 },
      isLoading: false,
      error: null,
      isFetching: false,
    }),
    useCrmMutation: () => ({ mutateAsync: noop, isPending: false }),
    useCompanies: () => ({
      data: { data: [], total: 0, limit: 50, offset: 0 },
      isLoading: false,
      error: null,
      isFetching: false,
    }),
    useIndustries: () => [],
    useTasks: () => ({
      tasks: [],
      isLoading: false,
      error: null,
      isPending: false,
      addTask: noop,
      updateTask: noop,
      completeTask: noop,
      cancelTask: noop,
    }),
    useMeetings: () => ({
      meetings: [],
      isLoading: false,
      error: null,
      isPending: false,
      addMeeting: noop,
      updateMeeting: noop,
      recordOutcome: noop,
    }),
    useProposals: () => ({
      proposals: [],
      isLoading: false,
      error: null,
      isPending: false,
      addProposal: noop,
      updateProposal: noop,
      setProposalStatus: noop,
    }),
    useAutomations: () => ({
      workflows: [],
      templates: [],
      runs: [],
      scheduledActions: [],
      isLoading: false,
      error: null,
      isPending: false,
      templateName: () => "-",
      addWorkflow: noop,
      updateWorkflow: noop,
      createDraft: noop,
      updateDraftSteps: noop,
      publishVersion: noop,
      duplicateWorkflow: noop,
      pauseRun: noop,
      resumeRun: noop,
      cancelRun: noop,
      retryRun: noop,
      addTemplate: noop,
      updateTemplate: noop,
    }),
    useDashboard: () => ({
      summary: {
        lifecycleFunnel: [],
        openDealsByStage: [],
        dealsThisMonth: { won: 0, lost: 0 },
        activityThisWeek: { aiCalls: 0, humanCalls: 0, emailsSent: 0, emailsReplied: 0 },
        tasks: { dueToday: 0, overdue: 0 },
        openDealsMissingNextAction: 0,
        meetingsToday: 0,
        proposalsAwaitingDecision: 0,
        todaysQueue: [],
      },
      isLoading: false,
      error: null,
    }),
  };
});

import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { CompaniesPage } from "@/features/companies/companies-page";
import { ContactsPage } from "@/features/contacts/contacts-page";
import { LeadsPage } from "@/features/leads/leads-page";
import { TasksPage } from "@/features/tasks/tasks-page";
import { MeetingsPage } from "@/features/meetings/meetings-page";
import { ProposalsPage } from "@/features/proposals/proposals-page";

afterEach(cleanup);

async function renderScreen(Screen: () => ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: Screen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screenRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("zero-record route states", () => {
  it.each([
    [DashboardPage, "Nothing due today."],
    [ContactsPage, "No contacts match these filters."],
    [CompaniesPage, "No companies match these filters."],
    [LeadsPage, "No leads match these filters."],
    [TasksPage, "Nothing here."],
    [MeetingsPage, "No meetings."],
    [ProposalsPage, "No proposals."],
  ])("renders an empty backend dataset", async (Screen, expectedText) => {
    const view = await renderScreen(Screen);
    expect(view.container).toHaveTextContent(expectedText);
  });
});
