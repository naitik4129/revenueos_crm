import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@/types";

const noop = vi.fn(async () => undefined);
const workspaceState = vi.hoisted(() => ({ list: [{ id: "w1", name: "One" }] }));

const contacts = [
  { id: "c-1", firstName: "John", lastName: "Smith", companyName: "Acme Corp" },
  { id: "c-2", firstName: "Priya", lastName: "Nair", companyName: "Globex" },
] as Contact[];

// Stands in for the server-side search: name or company contains the text.
const search = (text: string) =>
  contacts.filter((c) =>
    `${c.firstName} ${c.lastName} ${c.companyName}`.toLowerCase().includes(text.toLowerCase()),
  );

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
  useSession: () => ({
    users: [],
    currentUser: { name: "Test User", role: "Salesperson", initials: "TU" },
    userName: () => "Unassigned",
    isLoading: false,
    error: null,
  }),
  useContactSearch: (text: string) => ({ results: text ? search(text) : [], isFetching: false }),
  useCompanySearch: (text: string) => ({
    results:
      text && "globex".includes(text.toLowerCase()) ? [{ id: "co-1", name: "Globex Inc" }] : [],
    isFetching: false,
  }),
  // The Add contact dialog (closed in these tests) uses these.
  useCrmMutation: () => ({ mutateAsync: noop, isPending: false }),
  useNotifications: () => ({
    notifications: [],
    markNotificationsRead: noop,
  }),
}));

vi.mock("@/store/workspace-context", () => ({
  useWorkspace: () => ({
    workspaces: workspaceState.list,
    currentWorkspaceId: workspaceState.list[0]?.id ?? null,
    currentWorkspace: workspaceState.list[0] ?? null,
    setCurrentWorkspaceId: noop,
    isLoading: false,
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/app/app-shell";

afterEach(() => {
  cleanup();
  workspaceState.list = [{ id: "w1", name: "One" }];
});

async function renderShell() {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <AppShell>
          <Outlet />
        </AppShell>
      </QueryClientProvider>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <div>home</div>,
  });
  const contactRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/contacts/$contactId",
    component: function ContactScreen() {
      return <div>contact detail</div>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, contactRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const input = screen.getByPlaceholderText("Search contacts and companies");
  return { view, input, router };
}

describe("AppShell top search bar", () => {
  it("shows the server's matches with their company", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "SMITH" } });
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
  });

  it("shows nothing for a whitespace-only query", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows a no-results message instead of nothing", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "zzzznomatch" } });
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("closes the dropdown on Escape while keeping the query text", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "Smith" } });
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("Smith");
  });

  it("closes the dropdown when clicking outside", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "Smith" } });
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists matching companies under their own heading", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "glob" } });
    expect(await screen.findByText("Globex Inc")).toBeInTheDocument();
    expect(within(screen.getByRole("listbox")).getByText("Companies")).toBeInTheDocument();
  });

  it("focuses the search on Ctrl+K", async () => {
    const { input } = await renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();
  });

  it("navigates to the highlighted result on ArrowDown + Enter", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "a" } });
    await screen.findAllByRole("option"); // results arrive after the typing pause
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("contact detail")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });
});

describe("AppShell with no workspace", () => {
  it("tells a salesperson to ask an admin instead of rendering the page", async () => {
    workspaceState.list = [];
    await renderShell();
    expect(screen.getByText(/not a member of any workspace/)).toBeInTheDocument();
    expect(screen.queryByText("home")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });
});
