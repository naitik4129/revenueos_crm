import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "@/lib/backend-client";
import type { Contact, Deal, Task } from "@/types";

const api = vi.hoisted(() => ({ setOutcome: vi.fn(), markLost: vi.fn(), logCall: vi.fn() }));
vi.mock("@/lib/backend-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/backend-client")>();
  return {
    ...actual,
    backend: {
      ...actual.backend,
      deals: { ...actual.backend.deals, setOutcome: api.setOutcome, markLost: api.markLost },
      contacts: { ...actual.backend.contacts, logCall: api.logCall },
    },
  };
});
const state = vi.hoisted(() => ({ deal: {} as Deal, tasks: [] as Task[] }));
const loaded = <T,>(data: T) => ({ data, isLoading: false, error: null });
vi.mock("@/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store")>()),
  useSession: () => ({ users: [], currentUser: null }),
  useDeal: () => loaded(state.deal),
  useDealDetail: () => ({
    tasks: loaded({ data: state.tasks }),
    meetings: loaded({ data: [] }),
    proposals: loaded({ data: [] }),
    runs: loaded({ data: [] }),
    timeline: loaded({ data: [] }),
    notes: loaded({ data: [] }),
    contact: loaded({
      id: "c1",
      firstName: "Ann",
      lastName: "Lee",
      doNotContact: false,
    } as Contact),
  }),
  useAutomations: () => ({
    workflows: [
      {
        id: "w1",
        name: "Later nurture",
        trigger: "call_outcome_interested_later",
        status: "active",
        versions: [{ status: "published" }],
      },
      {
        id: "w2",
        name: "New deal welcome",
        trigger: "deal_created",
        status: "active",
        versions: [{ status: "published" }],
      },
    ],
    runs: [],
    scheduledActions: [],
    templateName: () => "-",
  }),
}));

import { DealDetailPage } from "./deal-detail-page";

const baseDeal = {
  id: "d1",
  contactId: "c1",
  contactName: "Ann Lee",
  companyName: "Acme",
  outcome: "open",
  stage: "new",
  automationMode: "manual",
  responseState: "no_response",
  lifecycleStage: "qualified",
  doNotContact: false,
  nextAction: null,
  closedAt: null,
  lastActivityAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
} as unknown as Deal;

async function renderDeal(deal: Partial<Deal> = {}, tasks: Task[] = []) {
  state.deal = { ...baseDeal, ...deal };
  state.tasks = tasks;
  const root = createRootRoute({ component: () => <Outlet /> });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => <DealDetailPage dealId="d1" />,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("deal page", () => {
  it("shows the header with outcome, stage and close date", async () => {
    await renderDeal({ outcome: "won", closedAt: "2026-10-10T06:00:00.000Z" });
    expect(screen.getByRole("heading", { name: "Ann Lee" })).toBeInTheDocument();
    expect(screen.getByText(/Closed 10 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Won" })).not.toBeInTheDocument();
  });

  it("marking lost needs a loss reason", async () => {
    api.markLost.mockResolvedValue({ ...baseDeal, outcome: "lost" });
    await renderDeal();
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));
    const confirm = screen.getByRole("button", { name: "Mark lost" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Loss reason"), { target: { value: "price_budget" } });
    fireEvent.click(confirm);
    await vi.waitFor(() =>
      expect(api.markLost).toHaveBeenCalledWith("d1", "price_budget", undefined),
    );
  });

  it("shows a 409 from reopening inside the dialog", async () => {
    api.setOutcome.mockRejectedValue(
      new BackendError(409, "conflict", "This contact already has an open deal."),
    );
    await renderDeal({ outcome: "nurture" });
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Reopen" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("already has an open deal");
    expect(api.setOutcome).toHaveBeenCalledWith("d1", "reopen", undefined);
  });

  it("enroll offers the workflow for the deal's nurture stage", async () => {
    await renderDeal({ stage: "interested_later" });
    fireEvent.click(screen.getByRole("button", { name: "Enroll" }));
    expect(await screen.findByText(/This deal is in nurture/)).toBeInTheDocument();
  });

  it("logs a call from a call task, sending that task's id", async () => {
    api.logCall.mockResolvedValue({
      call: {
        id: "k1",
        source: "human",
        connected: false,
        notConnectedReason: "no_answer",
        at: "",
      },
      contact: { id: "c1", doNotContact: false },
      deal: { ...baseDeal },
    });
    const task = {
      id: "t1",
      dealId: "d1",
      type: "call",
      title: "First call",
      status: "open",
      dueAt: new Date().toISOString(),
    } as Task;
    await renderDeal({}, [task]);
    fireEvent.click(screen.getAllByRole("button", { name: "Log call" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Not connected" }));
    fireEvent.click(screen.getByRole("button", { name: "Save call" }));
    await vi.waitFor(() =>
      expect(api.logCall).toHaveBeenCalledWith(
        "c1",
        expect.objectContaining({ taskId: "t1", connected: false }),
      ),
    );
  });
});
