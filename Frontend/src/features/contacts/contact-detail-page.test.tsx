import { cleanup, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ openDealId: undefined as string | undefined }));

const done = <T,>(data: T) => ({ data, isLoading: false, error: null });

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
  useSession: () => ({ users: [], currentUser: { id: "u1", role: "Salesperson" } }),
  useCrmMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useContactDetail: () => ({
    contact: done({
      id: "c1",
      firstName: "Asha",
      lastName: "Rao",
      jobTitle: "CTO",
      email: "asha@acme.test",
      phone: "+91 98000 00000",
      companyId: "co1",
      companyName: "Acme",
      source: "manual",
      status: "active",
      doNotContact: false,
      lifecycleStage: "engaged",
      lifecycleChangedAt: "2026-10-01T00:00:00Z",
      lastActivityAt: "2026-10-01T00:00:00Z",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      openDealId: state.openDealId,
    }),
    company: done({ id: "co1", name: "Acme", domain: "acme.test", industry: "Steel" }),
    meetings: done({ data: [] }),
    deals: done({
      data: state.openDealId
        ? [{ id: state.openDealId, stage: "new", outcome: "open", serviceInterest: "Hiring" }]
        : [],
    }),
    calls: done({ data: [] }),
    emails: done({ data: [] }),
    notes: done({ data: [] }),
    channels: done({ data: [] }),
    tasks: done({ data: [] }),
    timeline: done({
      data: [
        {
          id: "e1",
          at: new Date().toISOString(),
          kind: "system",
          title: "Absorbed Duplicate Contact",
          actor: "Sam",
          source: "user",
        },
      ],
    }),
  }),
}));

import { ContactDetailPage } from "./contact-detail-page";

afterEach(() => {
  cleanup();
  state.openDealId = undefined;
});

async function renderPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <ContactDetailPage contactId="c1" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Asha Rao" });
}

describe("ContactDetailPage", () => {
  it("shows the company card and plain-worded activity", async () => {
    await renderPage();
    expect(screen.getByText("acme.test · Steel")).toBeInTheDocument();
    expect(screen.getByText("A duplicate contact was merged into this one")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.queryByText("User")).not.toBeInTheDocument();
  });

  it("links Email to mailto and needs an open deal for Meeting", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "mailto:asha@acme.test",
    );
    expect(screen.getByRole("button", { name: "Meeting (Needs an open deal)" })).toBeDisabled();
  });

  it("enables Meeting when the contact has an open deal", async () => {
    state.openDealId = "d1";
    await renderPage();
    expect(screen.getByRole("button", { name: "Meeting" })).toBeEnabled();
  });
});
