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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[],
  update: vi.fn(async (id: string, input: unknown) => ({ id, ...(input as object) })),
}));

const company = (id: string, name: string) => ({
  id,
  name,
  domain: `${name.toLowerCase()}.test`,
  contactCount: 2,
  openDealCount: 0,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});
const done = <T,>(data: T) => ({ data, isLoading: false, error: null });

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
  useSession: () => ({
    users: [{ id: "u-sam", name: "Sam" }],
    currentUser: { id: "u-me", name: "Me", role: "Salesperson", initials: "ME" },
  }),
  useIndustries: () => ["Steel"],
  useCompanies: (params: Record<string, unknown>) => {
    calls.list.push(params);
    return {
      data: { data: [company("co1", "Acme"), company("co2", "Globex")], total: 2 },
      isLoading: false,
      error: null,
      isFetching: false,
    };
  },
  useCrmMutation: (fn: (input: unknown) => Promise<unknown>) => ({
    isPending: false,
    mutateAsync: fn,
    mutate: (input: unknown, opts?: { onSuccess?: (r: unknown) => void }) =>
      void fn(input).then((r) => opts?.onSuccess?.(r)),
  }),
  useCompanyDetail: () => ({
    company: done({ ...company("co1", "Acme"), industry: "Steel", city: "Pune" }),
    contacts: done({
      data: [
        {
          id: "c1",
          firstName: "Asha",
          lastName: "Rao",
          status: "active",
          lifecycleStage: "engaged",
        },
        {
          id: "c2",
          firstName: "Ravi",
          lastName: "K",
          status: "do_not_contact",
          lifecycleStage: "prospect",
        },
      ],
      total: 2,
    }),
    deals: done({
      data: [
        { id: "d1", stage: "new", outcome: "open", contactName: "Asha Rao", ownerName: "Sam" },
      ],
      total: 1,
    }),
    tasks: {
      data: [{ id: "t1", title: "Call back", type: "call", dueAt: "2026-10-30T05:00:00Z" }],
      isLoading: false,
    },
    timeline: done({ data: [] }),
  }),
}));

vi.mock("@/lib/backend-client", () => ({
  backend: { companies: { update: calls.update } },
}));

import { CompaniesPage } from "./companies-page";
import { CompanyDetailPage } from "./company-detail-page";

beforeEach(() => {
  calls.list.length = 0;
  calls.update.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

async function renderScreen(component: () => ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const route = createRoute({ getParentRoute: () => rootRoute, path: "/", component });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("CompaniesPage", () => {
  it("asks the server for the current user's companies on My companies", async () => {
    await renderScreen(CompaniesPage);
    fireEvent.click(await screen.findByRole("tab", { name: "My companies" }));
    await waitFor(() => expect(calls.list.at(-1)).toMatchObject({ ownerId: "u-me" }));
  });

  it("assigns an owner to the ticked companies through the companies API", async () => {
    await renderScreen(CompaniesPage);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Globex" }));
    fireEvent.click(screen.getByRole("button", { name: /Assign owner/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Unassigned" }));
    await waitFor(() => expect(calls.update).toHaveBeenCalledWith("co2", { ownerId: null }));
    expect(calls.update).toHaveBeenCalledTimes(1);
  });
});

describe("CompanyDetailPage", () => {
  it("shows contacts, deals and open tasks in the right column", async () => {
    await renderScreen(() => <CompanyDetailPage companyId="co1" />);
    expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByText("Contacts (2)")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Asha Rao" }).map((a) => a.getAttribute("href")),
    ).toEqual(["/contacts/c1", "/deals/d1"]);
    expect(screen.getByText("DNC")).toBeInTheDocument();
    expect(screen.getByText("Deals (1)")).toBeInTheDocument();
    expect(screen.getByText("Call back")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call (No phone number)" })).toBeDisabled();
  });
});
