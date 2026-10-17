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
import type { Workflow } from "@/types";

const workflow = (id: string, name: string, status: Workflow["status"]): Workflow => ({
  id,
  name,
  description: "",
  trigger: "deal_created",
  status,
  currentVersion: 1,
  activeLeads: 3,
  failures: 0,
  updatedAt: "2026-10-01T00:00:00Z",
  versions: [
    { version: 1, status: "published", createdBy: "Sam", createdAt: "2026-10-01", steps: [] },
  ],
});

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
  useSession: () => ({ userName: () => "Sam" }),
  useAutomations: () => ({
    workflows: [
      workflow("w1", "Welcome", "active"),
      workflow("w2", "Win back", "paused"),
      workflow("w3", "Proposal chase", "active"),
    ],
    isLoading: false,
    error: null,
    isPending: false,
    updateWorkflow: vi.fn(),
    duplicateWorkflow: vi.fn(),
    deleteWorkflow: vi.fn(),
    addWorkflow: vi.fn(),
  }),
}));

import { WorkflowsPage } from "./workflows-page";

afterEach(cleanup);

async function renderPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/", component: WorkflowsPage }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("Welcome");
}

describe("WorkflowsPage tabs", () => {
  it("counts each status and shows only that status's workflows", async () => {
    await renderPage();
    expect(screen.getByRole("tab", { name: "All (3)" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Paused (1)" }));
    expect(screen.getByText("Win back")).toBeInTheDocument();
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Active (2)" }));
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Proposal chase")).toBeInTheDocument();
    expect(screen.queryByText("Win back")).not.toBeInTheDocument();
  });

  it("combines the tab with the search", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Active (2)" }));
    fireEvent.change(screen.getByLabelText("Search workflows"), { target: { value: "chase" } });
    expect(screen.getByText("Proposal chase")).toBeInTheDocument();
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search workflows"), { target: { value: "win" } });
    expect(screen.getByText("No workflows match.")).toBeInTheDocument();
  });
});
