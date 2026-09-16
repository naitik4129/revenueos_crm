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
import type { Lead } from "@/types/lead";

const noop = vi.fn(async () => undefined);

const leads: Lead[] = [
  {
    id: "lead-1",
    firstName: "John",
    lastName: "Smith",
    company: "Acme Corp",
    jobTitle: "VP Sales",
    industry: "Manufacturing",
    phone: "+1-555-0100",
    email: "john.smith@acme.test",
    source: "linkedin",
    serviceInterest: "Automation Suite",
    pipelineStage: "connected_qualifying",
    lifecycleState: "active",
    automationMode: "active",
    responseState: "no_response",
    doNotContact: false,
    lastActivityAt: "2026-09-01T00:00:00.000Z",
    nextAction: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "lead-2",
    firstName: "Priya",
    lastName: "Nair",
    company: "Globex",
    jobTitle: "CTO",
    industry: "Software",
    phone: "+1-555-0101",
    email: "priya.nair@globex.test",
    source: "referral",
    serviceInterest: "Consulting",
    pipelineStage: "negotiation",
    lifecycleState: "active",
    automationMode: "manual",
    responseState: "responded",
    doNotContact: false,
    lastActivityAt: "2026-09-02T00:00:00.000Z",
    nextAction: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
];

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
  useSession: () => ({
    users: [],
    currentUser: { name: "Test User", role: "Salesperson", initials: "TU" },
    userName: () => "Unassigned",
    isLoading: false,
    error: null,
  }),
  useLeads: () => ({
    leads,
    getLead: (id: string) => leads.find((l) => l.id === id),
    isLoading: false,
    error: null,
    isPending: false,
    addLead: noop,
    updateLead: noop,
    addNote: noop,
    setAutomation: noop,
    markDnc: noop,
    reactivateFromDnc: noop,
    logCall: noop,
    logCommunication: noop,
    setLifecycle: noop,
  }),
  useNotifications: () => ({
    notifications: [],
    markNotificationsRead: noop,
  }),
}));

import { AppShell } from "@/app/app-shell";

afterEach(cleanup);

async function renderShell() {
  const rootRoute = createRootRoute({
    component: () => (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <div>home</div>,
  });
  const leadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/leads/$leadId",
    component: function LeadScreen() {
      return <div>lead detail</div>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, leadRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const input = screen.getByPlaceholderText("Search leads and companies…");
  return { view, input, router };
}

describe("AppShell top search bar", () => {
  it("is case-insensitive", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "SMITH" } });
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
  });

  it("matches on fields beyond name/company: email, phone, job title, stage", async () => {
    const { input } = await renderShell();

    fireEvent.change(input, { target: { value: "priya.nair@globex.test" } });
    expect(await screen.findByText("Globex")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "555-0100" } });
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "CTO" } });
    expect(await screen.findByText("Globex")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Negotiation" } });
    expect(await screen.findByText("Globex")).toBeInTheDocument();
  });

  it("matches multi-word queries regardless of token order", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "Corp John" } });
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.queryByText("Globex")).not.toBeInTheDocument();
  });

  it("shows nothing for a whitespace-only query", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows a no-results message instead of nothing", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "zzzznomatch" } });
    expect(await screen.findByText(/No leads match/)).toBeInTheDocument();
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

  it("navigates to the highlighted result on ArrowDown + Enter", async () => {
    const { input } = await renderShell();
    fireEvent.change(input, { target: { value: "a" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("lead detail")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });
});
