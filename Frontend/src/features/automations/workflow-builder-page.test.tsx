import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@/types";

const { storeState, updateWorkflowMock } = vi.hoisted(() => ({
  storeState: { current: undefined as unknown },
  updateWorkflowMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
  useSession: () => ({
    users: [],
    currentUser: null,
    userName: () => "Unassigned",
    isLoading: false,
    error: null,
  }),
  useAutomations: () => storeState.current,
}));

import { WorkflowBuilderPage } from "./workflow-builder-page";

const workflow: Workflow = {
  id: "workflow-1",
  name: "Send Me Detail First",
  description: "Client is requesting details",
  trigger: "call_outcome_information_requested",
  status: "paused",
  currentVersion: 1,
  activeLeads: 0,
  failures: 0,
  ownerId: "user-1",
  updatedAt: "2030-01-01T00:00:00.000Z",
  versions: [
    {
      version: 1,
      status: "draft",
      createdBy: "Test User",
      createdAt: "2030-01-01T00:00:00.000Z",
      steps: [],
    },
  ],
};

async function renderBuilder() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <WorkflowBuilderPage workflowId={workflow.id} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screenRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  updateWorkflowMock.mockResolvedValue(undefined);
  storeState.current = {
    workflows: [workflow],
    templates: [],
    isLoading: false,
    error: null,
    isPending: false,
    templateName: () => "-",
    addWorkflow: vi.fn(),
    updateWorkflow: updateWorkflowMock,
    createDraft: vi.fn(),
    updateDraftSteps: vi.fn(),
    publishVersion: vi.fn(),
    duplicateWorkflow: vi.fn(),
    deleteWorkflow: vi.fn(),
    deleteWorkflowVersion: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    cancelRun: vi.fn(),
    retryRun: vi.fn(),
    enrollLead: vi.fn(),
    addTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    uploadTemplateAttachment: vi.fn(),
    deleteTemplateAttachment: vi.fn(),
  };
});

afterEach(cleanup);

describe("WorkflowBuilderPage details editor", () => {
  it("saves trimmed workflow name and description", async () => {
    await renderBuilder();

    fireEvent.click(screen.getByLabelText("Edit workflow details"));
    fireEvent.change(screen.getByLabelText("Workflow name"), {
      target: { value: "  Send details immediately  " },
    });
    fireEvent.change(screen.getByLabelText("Workflow description"), {
      target: { value: "  Share brochure and pricing  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(updateWorkflowMock).toHaveBeenCalledWith(workflow.id, {
        name: "Send details immediately",
        description: "Share brochure and pricing",
      });
    });
  });

  it("blocks saving an empty workflow name", async () => {
    await renderBuilder();

    fireEvent.click(screen.getByLabelText("Edit workflow details"));
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(updateWorkflowMock).not.toHaveBeenCalled();
  });

  it("cancels edits and restores display mode", async () => {
    await renderBuilder();

    fireEvent.click(screen.getByLabelText("Edit workflow details"));
    fireEvent.change(screen.getByLabelText("Workflow name"), {
      target: { value: "Changed locally" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("heading", { name: workflow.name })).toBeInTheDocument();
    expect(screen.queryByLabelText("Workflow name")).not.toBeInTheDocument();
    expect(updateWorkflowMock).not.toHaveBeenCalled();
  });
});

describe("WorkflowBuilderPage step flow", () => {
  const steps = [
    { id: "s1", order: 0, delayDays: 0, action: "send_email", templateId: "t1", enabled: true },
    { id: "s2", order: 1, delayDays: 2, action: "send_whatsapp", enabled: true },
  ] as Workflow["versions"][number]["steps"];

  it("marks a draft as not live, reads waits in words and offers add-step between steps", async () => {
    storeState.current = {
      ...(storeState.current as object),
      workflows: [{ ...workflow, versions: [{ ...workflow.versions[0]!, steps }] }],
    };
    await renderBuilder();
    expect(screen.getByRole("status")).toHaveTextContent("Draft V1 is not live");
    expect(screen.getByText("Right after enrollment")).toBeInTheDocument();
    expect(screen.getByText("Wait 2 days")).toBeInTheDocument();
    expect(screen.getByText("Day 2")).toBeInTheDocument();
    expect(screen.getByText("No Template")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert step before step 2" })).toBeInTheDocument();
  });

  it("says the draft is not saved when the server refuses the steps", async () => {
    storeState.current = {
      ...(storeState.current as object),
      workflows: [{ ...workflow, versions: [{ ...workflow.versions[0]!, steps }] }],
      updateDraftSteps: vi
        .fn()
        .mockRejectedValue(new Error("Step 3 (send_email) requires a template.")),
    };
    await renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Insert step before step 2" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Not saved: Step 3 (send_email) requires a template.",
      ),
    );
  });

  it("marks the live version read-only, without insert buttons", async () => {
    storeState.current = {
      ...(storeState.current as object),
      workflows: [
        { ...workflow, versions: [{ ...workflow.versions[0]!, status: "published", steps }] },
      ],
    };
    await renderBuilder();
    expect(screen.getByRole("status")).toHaveTextContent("V1 is live");
    expect(screen.queryByRole("button", { name: /Insert step/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit as new draft" })).toBeInTheDocument();
  });
});
