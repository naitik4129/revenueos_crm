import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { BackendError } from "@/lib/backend-client";
import type { Deal } from "@/types";

const api = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn() }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/lib/backend-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/backend-client")>();
  return { ...actual, backend: { ...actual.backend, deals: { ...actual.backend.deals, ...api } } };
});
const deals = vi.hoisted(() => ({ list: [] as Deal[], calls: [] as Record<string, unknown>[] }));
vi.mock("@/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store")>()),
  useSession: () => ({ users: [], currentUser: null }),
  useDeals: (filters: { outcome?: string }) => {
    deals.calls.push(filters);
    return {
      data: {
        data: deals.list.filter((d) => !filters.outcome || d.outcome === filters.outcome),
        total: deals.list.length,
      },
      isLoading: false,
      error: null,
    };
  },
}));
vi.mock("@/features/contacts/pickers", () => ({
  ContactPicker: ({ onChange }: { onChange: (o: { id: string; label: string }) => void }) => (
    <button onClick={() => onChange({ id: "c1", label: "Ann" })}>pick contact</button>
  ),
}));

import { DealsPage } from "./deals-page";

const deal = (
  id: string,
  contactName: string,
  stage: Deal["stage"],
  outcome: Deal["outcome"] = "open",
) =>
  ({
    id,
    contactName,
    stage,
    outcome,
    nextAction: null,
    amount: null,
    currency: "INR",
    lastActivityAt: new Date().toISOString(),
  }) as Deal;

async function renderPage(page: () => ReactNode = DealsPage) {
  const root = createRootRoute({ component: () => <Outlet /> });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/", component: page }),
      createRoute({
        getParentRoute: () => root,
        path: "/deals/$dealId",
        component: () => <div>deal page</div>,
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
const column = (stage: string) => screen.getByRole("region", { name: `${stage} column` });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("deals board", () => {
  it("shows open deals in their stage column with counts", async () => {
    deals.list = [
      deal("d1", "Ann", "new"),
      deal("d2", "Bob", "negotiation"),
      deal("d3", "Cy", "new", "won"),
    ];
    await renderPage();
    expect(within(column("New")).getByText("Ann")).toBeInTheDocument();
    expect(within(column("New")).getByText("1")).toBeInTheDocument();
    expect(within(column("Negotiation")).getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Cy")).not.toBeInTheDocument(); // won: not on the board
  });

  it("shows each stage's total and each card's amount; the list has an Amount column", async () => {
    deals.list = [
      { ...deal("d1", "Ann", "new"), amount: 300000 },
      { ...deal("d2", "Bob", "new"), amount: 150000 },
      deal("d3", "Cy", "negotiation"),
    ];
    await renderPage();
    expect(within(column("New")).getByLabelText("New total")).toHaveTextContent("₹4.5 L");
    expect(within(column("Negotiation")).getByLabelText("Negotiation total")).toHaveTextContent(
      "₹0",
    );
    expect(within(column("New")).getByText("₹3.0 L")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
    expect(screen.getByText("₹1.5 L")).toBeInTheDocument();
  });

  it("moves a deal with the stage dropdown", async () => {
    deals.list = [deal("d1", "Ann", "new")];
    api.update.mockResolvedValue(deal("d1", "Ann", "negotiation"));
    await renderPage();
    fireEvent.change(screen.getByLabelText("Stage for Ann"), { target: { value: "negotiation" } });
    // The card shows in its new column at once, while the move is being saved.
    expect(within(column("Negotiation")).getByText("Ann")).toBeInTheDocument();
    // react-query calls the API on the next tick.
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledWith("d1", { stage: "negotiation" }));
  });

  it("shows the error and puts the card back when the move is refused", async () => {
    deals.list = [deal("d1", "Ann", "new")];
    api.update.mockRejectedValue(
      new BackendError(422, "invalid_transition", "Objection Nurture needs an objection type."),
    );
    await renderPage();
    fireEvent.change(screen.getByLabelText("Stage for Ann"), {
      target: { value: "objection_nurture" },
    });
    expect(await within(column("New")).findByText("Ann")).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Ann: Objection Nurture needs an objection type.");
    expect(screen.getByLabelText("Stage for Ann")).toHaveValue("new");
  });

  it("moves a deal by drag and drop", async () => {
    deals.list = [deal("d1", "Ann", "new")];
    api.update.mockResolvedValue(deal("d1", "Ann", "proposal_sent"));
    await renderPage();
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? "",
      get types() {
        return [...store.keys()];
      },
      effectAllowed: "",
    };
    fireEvent.dragStart(screen.getByRole("article", { name: "Deal: Ann" }), { dataTransfer });
    fireEvent.dragOver(column("Proposal Sent"), { dataTransfer });
    fireEvent.drop(column("Proposal Sent"), { dataTransfer });
    // react-query calls the API on the next tick.
    await vi.waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("d1", { stage: "proposal_sent" }),
    );
  });

  it("the No next action view asks for deals missing a next action", async () => {
    deals.list = [deal("d1", "Ann", "new")];
    await renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "No next action" }));
    await vi.waitFor(() =>
      expect(deals.calls.at(-1)).toMatchObject({ outcome: "open", missingNextAction: true }),
    );
  });

  it("list view assigns an owner to the ticked deals", async () => {
    deals.list = [deal("d1", "Ann", "new"), deal("d2", "Bob", "new")];
    api.update.mockResolvedValue(deal("d1", "Ann", "new"));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bob" }));
    fireEvent.click(screen.getByRole("button", { name: /Assign owner/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Unassigned" }));
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledWith("d2", { ownerId: null }));
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it("list view shows every outcome", async () => {
    deals.list = [deal("d1", "Ann", "new"), deal("d3", "Cy", "new", "won")];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByText("Cy")).toBeInTheDocument();
  });
});

describe("new deal dialog", () => {
  it("explains a second open deal and links to the existing one", async () => {
    deals.list = [];
    api.create.mockRejectedValue(
      new BackendError(409, "conflict", "This contact already has an open deal.", {
        reason: "open_deal_exists",
        dealId: "d-open",
      }),
    );
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create deal" }));
    fireEvent.click(screen.getByText("pick contact"));
    fireEvent.click(screen.getByRole("button", { name: "Create deal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already has an open deal");
    expect(screen.getByRole("link", { name: "Open the existing deal" })).toHaveAttribute(
      "href",
      "/deals/d-open",
    );
  });
});
