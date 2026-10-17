import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { percent } from "@/lib/format";

const mutate = vi.hoisted(() => vi.fn());

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
  useSession: () => ({ currentUser: { name: "Sam Sales", role: "Salesperson" } }),
  useCrmMutation: () => ({ mutate, isPending: false }),
  useDashboard: () => ({
    isLoading: false,
    error: null,
    summary: {
      lifecycleFunnel: [
        { stage: "prospect", count: 6 },
        { stage: "contacted", count: 3 },
        { stage: "engaged", count: 1 },
        { stage: "qualified", count: 0 },
        { stage: "customer", count: 0 },
      ],
      openDealsByStage: [],
      dealsThisMonth: { won: 3, lost: 1 },
      activityThisWeek: { aiCalls: 0, humanCalls: 0, emailsSent: 0, emailsReplied: 0 },
      tasks: { dueToday: 2, overdue: 4 },
      openDealsMissingNextAction: 1,
      meetingsToday: 0,
      proposalsAwaitingDecision: 0,
      todaysQueue: [
        {
          id: "t1",
          contactId: "c1",
          contactName: "Ann",
          title: "Send brochure",
          type: "follow_up",
          dueAt: new Date().toISOString(),
        },
        {
          id: "t2",
          dealId: "d2",
          contactName: "Bob",
          title: "First call",
          type: "call",
          dueAt: new Date().toISOString(),
        },
      ],
    },
  }),
}));
vi.mock("@/store/workspace-context", () => ({
  useWorkspace: () => ({ currentWorkspace: { id: "w1", name: "Acme Client" } }),
}));

import { DashboardPage } from "./dashboard-page";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

async function renderPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardPage }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("Overdue tasks");
}

describe("percent", () => {
  it("is a share of the total, never 0% for a non-zero count", () => {
    expect(percent(1, 3)).toBe("33%");
    expect(percent(1, 500)).toBe("<1%");
    expect(percent(0, 10)).toBe("0%");
    expect(percent(0, 0)).toBe("0%");
  });
});

describe("DashboardPage", () => {
  it("links each stat card to its filtered list", async () => {
    await renderPage();
    const href = (text: string) => screen.getByText(text).closest("a")?.getAttribute("href");
    expect(href("Overdue tasks")).toBe("/tasks?view=overdue");
    expect(href("Tasks due today")).toBe("/tasks?view=today");
    expect(href("Meetings today")).toBe("/meetings?view=today");
    expect(href("Open deals with no next action")).toBe("/deals?view=noNext");
  });

  it("scales bars against the total and shows count and percent", async () => {
    await renderPage();
    expect(screen.getByText("Contacts by lifecycle stage (10)")).toBeInTheDocument();
    const prospect = screen.getByRole("img", { name: "Prospect: 6 of 10" });
    expect((prospect.firstChild as HTMLElement).style.width).toBe("60%");
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("No open deals.")).toBeInTheDocument();
    expect(screen.getByText("Win rate 75% of 4 closed.")).toBeInTheDocument();
  });

  it("completes a queue task inline; a call task opens its deal", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(mutate).toHaveBeenCalledWith("t1", expect.anything());
    expect(screen.getByRole("link", { name: "Log call" })).toHaveAttribute("href", "/deals/d2");
  });
});
