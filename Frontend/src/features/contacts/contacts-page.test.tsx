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

const calls = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[],
  update: vi.fn(async (id: string, input: unknown) => ({ id, ...(input as object) })),
}));

const contact = (id: string, firstName: string) => ({
  id,
  firstName,
  lastName: "Test",
  email: `${firstName.toLowerCase()}@x.test`,
  phone: "+91 98000 00000",
  source: "manual",
  status: "active",
  doNotContact: false,
  lifecycleStage: "prospect",
  lifecycleChangedAt: "2026-10-01T00:00:00Z",
  lastActivityAt: "2026-10-01T00:00:00Z",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
  useSession: () => ({
    users: [{ id: "u-sam", name: "Sam" }],
    currentUser: { id: "u-me", name: "Me", role: "Salesperson", initials: "ME" },
  }),
  useContacts: (params: Record<string, unknown>) => {
    calls.list.push(params);
    return {
      data: { data: [contact("c1", "Asha"), contact("c2", "Ravi")], total: 2 },
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
}));

vi.mock("@/lib/backend-client", () => ({
  backend: { contacts: { update: calls.update } },
}));

import { ContactsPage } from "./contacts-page";

beforeEach(() => {
  calls.list.length = 0;
  calls.update.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

async function renderPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: ContactsPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("Asha Test");
}

describe("ContactsPage", () => {
  it("asks the server for the current user's contacts on the My contacts view", async () => {
    await renderPage();
    expect(screen.getByRole("tab", { name: "All contacts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "My contacts" }));
    await waitFor(() => expect(calls.list.at(-1)).toMatchObject({ ownerId: "u-me" }));
    expect(screen.getByRole("tab", { name: "My contacts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("the Unassigned view asks the server for contacts with no owner", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Unassigned" }));
    await waitFor(() => expect(calls.list.at(-1)).toMatchObject({ ownerId: "none" }));
    expect(screen.getByRole("tab", { name: "Unassigned" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("sorts by a column header (ascending, then descending), back to page 1, remembered per browser", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sort by Last activity" }));
    await waitFor(() =>
      expect(calls.list.at(-1)).toMatchObject({ sort: "lastActivity", offset: 0 }),
    );
    expect(screen.getByRole("columnheader", { name: /Last activity/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort by Last activity (ascending)" }));
    await waitFor(() => expect(calls.list.at(-1)).toMatchObject({ sort: "-lastActivity" }));
    expect(JSON.parse(localStorage.getItem("contacts.sort") ?? "null")).toBe("-lastActivity");
    // The name column sorts too; unsortable columns have no button.
    expect(screen.getByRole("button", { name: "Sort by Name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort by Email" })).toBeNull();
  });

  it("starts with the sort saved in this browser, and ignores a stale one", async () => {
    localStorage.setItem("contacts.sort", JSON.stringify("-name"));
    await renderPage();
    expect(calls.list[0]).toMatchObject({ sort: "-name" });
    cleanup();
    calls.list.length = 0;
    localStorage.setItem("contacts.sort", JSON.stringify("email"));
    await renderPage();
    expect(calls.list[0]?.["sort"]).toBeUndefined();
  });

  it("assigns an owner to every selected contact", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Assign owner/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Sam" }));
    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(2));
    expect(calls.update).toHaveBeenCalledWith("c1", { ownerId: "u-sam" });
    expect(calls.update).toHaveBeenCalledWith("c2", { ownerId: "u-sam" });
    await waitFor(() => expect(screen.queryByText("2 selected")).not.toBeInTheDocument());
  });

  it("hides a column unticked in the column chooser and remembers it", async () => {
    await renderPage();
    expect(screen.getByRole("columnheader", { name: "Phone" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Phone" }));
    expect(screen.queryByRole("columnheader", { name: "Phone" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("contacts.columns") ?? "[]")).not.toContain("phone");
  });
});
