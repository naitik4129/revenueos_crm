import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[],
  complete: vi.fn(async () => undefined),
}));

const task = (id: string, title: string, type: string, dealId?: string) => ({
  id,
  title,
  type,
  dealId,
  contactName: "Ann Lee",
  status: "open",
  done: false,
  origin: "manual",
  dueAt: new Date().toISOString(),
});

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
  useSession: () => ({ users: [], userName: () => "Sam" }),
  useCrmMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useTasks: (params: Record<string, unknown>) => {
    calls.list.push(params);
    return {
      tasks: [
        task("t1", "Send brochure", "follow_up", "d1"),
        task("t2", "First call", "call", "d2"),
      ],
      total: 2,
      isLoading: false,
      error: null,
      isPending: false,
      completeTask: calls.complete,
    };
  },
  useTaskTotals: () => [2, 5, 7, 11],
}));

import { TasksPage } from "./tasks-page";

afterEach(() => {
  cleanup();
  calls.list.length = 0;
  calls.complete.mockClear();
});

async function renderPage(initialView?: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/",
        component: () => <TasksPage initialView={initialView} />,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("Send brochure");
}

describe("TasksPage", () => {
  it("shows a count on every tab and switches the server filter", async () => {
    await renderPage();
    for (const name of ["Today (2)", "Overdue (5)", "Upcoming (7)", "Done (11)"])
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Overdue (5)" }));
    await waitFor(() => expect(calls.list.at(-1)).toMatchObject({ overdueOnly: true, offset: 0 }));
  });

  it("opens on the tab the dashboard linked to", async () => {
    await renderPage("overdue");
    expect(calls.list[0]).toMatchObject({ overdueOnly: true });
    expect(screen.getByRole("tab", { name: "Overdue (5)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("completes a task inline; a call task links to its deal instead", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(calls.complete).toHaveBeenCalledWith("t1"));
    expect(screen.getByRole("link", { name: "Log call" })).toHaveAttribute("href", "/deals/d2");
    expect(screen.getAllByRole("button", { name: "Reschedule" })).toHaveLength(2);
  });
});
