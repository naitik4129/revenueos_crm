import { cleanup, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { StoreProvider } from "@/store";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { LeadsPage } from "@/features/leads/leads-page";
import { LeadDetailPage } from "@/features/leads/lead-detail-page";
import { AddLeadDialog } from "@/features/leads/add-lead-dialog";
import { TasksPage } from "@/features/tasks/tasks-page";
import { MeetingsPage } from "@/features/meetings/meetings-page";
import { ProposalsPage } from "@/features/proposals/proposals-page";
import { WorkflowsPage } from "@/features/automations/workflows-page";
import { TemplatesPage } from "@/features/automations/templates-page";
import { RunsPage } from "@/features/automations/runs-page";
import { WorkflowBuilderPage } from "@/features/automations/workflow-builder-page";

afterEach(cleanup);

async function renderScreen(Screen: () => ReactNode) {
  const rootRoute = createRootRoute({
    component: () => (
      <StoreProvider>
        <Outlet />
      </StoreProvider>
    ),
  });
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

describe("application screens", () => {
  it.each([
    [DashboardPage, "Everything due today"],
    [LeadsPage, "One row per lead"],
    [() => <LeadDetailPage leadId="l1" />, "Rahul Patel"],
    [TasksPage, "Completing a task keeps the lead moving"],
    [MeetingsPage, "Every meeting booked from the CRM"],
    [ProposalsPage, "Manual upload, simple statuses"],
    [WorkflowsPage, "New workflow"],
    [TemplatesPage, "New template"],
    [RunsPage, "Current step"],
    [() => <WorkflowBuilderPage workflowId="wf1" />, "Not Connected Nurture"],
  ])("renders a primary feature screen", async (Screen, expectedText) => {
    await renderScreen(Screen);
    expect(document.body).toHaveTextContent(expectedText);
  });

  it("renders the existing add-lead dialog", async () => {
    await renderScreen(() => <AddLeadDialog open onOpenChange={() => undefined} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("Add lead");
  });
});
