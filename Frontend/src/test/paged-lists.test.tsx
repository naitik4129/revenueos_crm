import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Params = Record<string, unknown> & { when?: unknown };

// Every list hook records the params it was called with, so the tests can check what the
// page asks the server for (filters, search, offset).
const calls = vi.hoisted(() => ({
  meetings: [] as Params[],
  proposals: [] as Params[],
  runs: [] as Params[],
  actions: [] as Params[],
}));

vi.mock("@/store", () => {
  const noop = vi.fn(async () => undefined);
  const page = <T,>(rows: T[], total: number) => ({
    data: { data: rows, total },
    isLoading: false,
    error: null,
  });
  const meeting = (id: string, title: string) => ({
    id,
    dealId: "d1",
    title,
    at: new Date().toISOString(),
    status: "scheduled",
    calendarSyncStatus: "synced",
  });
  return {
    messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
    useSession: () => ({ users: [], userName: () => "Sam" }),
    useMeetings: (params: Params) => {
      calls.meetings.push(params);
      const today = params.when === "today";
      return {
        meetings: [
          today ? meeting("t1", "Today call") : meeting("m1", `${String(params.when)} call`),
        ],
        total: today ? 1 : 120,
        isLoading: false,
        error: null,
        isPending: false,
        addMeeting: noop,
        updateMeeting: noop,
        recordOutcome: noop,
      };
    },
    useProposals: (params: Params) => {
      calls.proposals.push(params);
      return {
        proposals: [],
        total: 75,
        isLoading: false,
        error: null,
        isPending: false,
        setProposalStatus: noop,
      };
    },
    useProposalSummary: () => ({ data: { open: 7, awaitingDecision: 3, valueInPlay: 125000 } }),
    useAutomations: () => ({
      workflows: [],
      templates: [],
      isPending: false,
      pauseRun: noop,
      resumeRun: noop,
      cancelRun: noop,
      retryRun: noop,
    }),
    useRuns: (params: Params) => {
      calls.runs.push(params);
      return page([], 120);
    },
    useScheduledActions: (params: Params) => {
      calls.actions.push(params);
      return page([], 0);
    },
  };
});

import { MeetingsPage } from "@/features/meetings/meetings-page";
import { ProposalsPage } from "@/features/proposals/proposals-page";
import { RunsPage } from "@/features/automations/runs-page";

async function renderScreen(Screen: () => ReactNode) {
  const root = createRootRoute({ component: () => <Outlet /> });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/", component: Screen }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const last = (list: Params[]) => list[list.length - 1];

beforeAll(() => {
  Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
});
beforeEach(() => {
  calls.meetings.length = 0;
  calls.proposals.length = 0;
  calls.runs.length = 0;
  calls.actions.length = 0;
});
afterEach(cleanup);

describe("server-paged lists", () => {
  it("meetings: Upcoming/Past tabs filter on the server, Today has its own query", async () => {
    await renderScreen(MeetingsPage);
    expect(calls.meetings).toContainEqual({ when: "today", limit: 50 });
    expect(last(calls.meetings.filter((p) => p.when !== "today"))).toEqual({
      when: "upcoming",
      limit: 50,
      offset: 0,
    });
    expect(screen.getByText("Today call")).toBeInTheDocument();
    expect(screen.getByText("1-50 of 120")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(last(calls.meetings.filter((p) => p.when !== "today"))).toMatchObject({ offset: 50 }),
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Past" }), { button: 0 });
    await waitFor(() =>
      expect(last(calls.meetings.filter((p) => p.when !== "today"))).toEqual({
        when: "past",
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("proposals: stat cards come from the workspace summary, the table is paged", async () => {
    await renderScreen(ProposalsPage);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(last(calls.proposals)).toEqual({ limit: 50, offset: 0 });
    expect(screen.getByText("1-50 of 75")).toBeInTheDocument();
  });

  it("runs: search and paging go to the server", async () => {
    await renderScreen(RunsPage);
    expect(last(calls.runs)).toEqual({ search: undefined, limit: 50, offset: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(last(calls.runs)).toMatchObject({ offset: 50 }));

    fireEvent.change(screen.getByLabelText("Search runs"), { target: { value: " Acme " } });
    await waitFor(() => expect(last(calls.runs)).toEqual({ search: "Acme", limit: 50, offset: 0 }));
    expect(last(calls.actions)).toEqual({ search: "Acme", limit: 50, offset: 0 });
  });
});
