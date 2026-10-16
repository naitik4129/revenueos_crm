import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { api, session } = vi.hoisted(() => ({
  api: {
    admin: { users: { list: vi.fn(), create: vi.fn(), update: vi.fn() } },
    workspaces: {
      create: vi.fn(),
      update: vi.fn(),
      members: vi.fn(),
      setMembers: vi.fn(),
      brainKeys: { list: vi.fn(), create: vi.fn(), revoke: vi.fn() },
    },
    templates: { list: vi.fn(), update: vi.fn() },
  },
  session: { role: "Admin" as "Admin" | "Salesperson" },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/backend-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend-client")>()),
  backend: api,
}));
vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
  useSession: () => ({
    currentUser: { id: "u-admin", role: session.role },
    userName: (id?: string) => (id === "u-sam" ? "Sam Sales" : "Unassigned"),
  }),
}));
vi.mock("@/store/workspace-context", () => ({
  useWorkspace: () => ({ workspaces: [WORKSPACE] }),
}));

import { UsersTab } from "./users-tab";
import { MembersTab } from "./members-tab";
import { BrainKeysTab } from "./brain-keys-tab";
import { WorkspacesTab } from "./workspaces-tab";
import { DefaultsPanel } from "@/features/settings/defaults-panel";

const WORKSPACE = {
  id: "ws-1",
  name: "Acme Client",
  slug: "acme-client",
  isActive: true,
  platformProjectId: null,
  defaultOwnerId: "u-sam",
  defaultMeetingEmailTemplateId: null,
  defaultMeetingWhatsappTemplateId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const user = (id: string, name: string, role: "admin" | "salesperson", active = true) => ({
  id,
  name,
  email: `${id}@demo.local`,
  initials: name.slice(0, 2),
  role,
  active,
  createdAt: "2026-10-01T00:00:00.000Z",
});
const ADMIN = user("u-admin", "Asha Admin", "admin");
const SAM = user("u-sam", "Sam Sales", "salesperson");
const RAVI = user("u-ravi", "Ravi Former", "salesperson", false);

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeAll(() => {
  // Radix Select needs these in jsdom.
  Object.assign(window.HTMLElement.prototype, {
    hasPointerCapture: vi.fn(() => false),
    releasePointerCapture: vi.fn(),
    scrollIntoView: vi.fn(),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  session.role = "Admin";
  api.admin.users.list.mockResolvedValue({ data: [ADMIN, SAM, RAVI] });
  api.workspaces.members.mockResolvedValue({ data: [SAM] });
  api.workspaces.brainKeys.list.mockResolvedValue({
    data: [
      {
        id: "k-1",
        label: "RevenueOS brain",
        prefix: "nbk_abcdefgh",
        createdAt: "2026-10-01T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
  });
  api.templates.list.mockResolvedValue({ data: [] });
});

afterEach(cleanup);

describe("admin users tab", () => {
  it("lists users with role and active controls, locked on the admin's own row", async () => {
    renderWithClient(<UsersTab />);
    expect(await screen.findByText("Ravi Former")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Active: Asha Admin" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Active: Ravi Former" })).not.toBeChecked();

    api.admin.users.update.mockResolvedValue({ ...SAM, active: false });
    fireEvent.click(screen.getByRole("switch", { name: "Active: Sam Sales" }));
    await waitFor(() =>
      expect(api.admin.users.update).toHaveBeenCalledWith("u-sam", { active: false }),
    );
  });

  it("adds an existing account by email and role only", async () => {
    api.admin.users.create.mockResolvedValue(SAM);
    renderWithClient(<UsersTab />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " pat@x.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Give CRM access" }));
    await waitFor(() =>
      expect(api.admin.users.create.mock.calls[0]?.[0]).toEqual({
        email: "pat@x.com",
        role: "salesperson",
      }),
    );
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });
});

describe("admin workspaces tab", () => {
  it("shows each workspace with its default owner chosen from the members", async () => {
    renderWithClient(<WorkspacesTab />);
    expect(screen.getByDisplayValue("Acme Client")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Default owner" })).toHaveTextContent(
        "Sam Sales",
      ),
    );
  });
});

describe("admin members tab", () => {
  it("ticks current members and saves the new list", async () => {
    api.workspaces.setMembers.mockResolvedValue({ data: [SAM, RAVI] });
    renderWithClient(<MembersTab />);
    const ravi = (await screen.findByText("Ravi Former")).closest("label")!;
    const sam = screen.getByText("Sam Sales").closest("label")!;
    expect(within(sam).getByRole("checkbox")).toBeChecked();
    expect(screen.queryByText("Asha Admin")).toBeNull(); // admins are never members

    fireEvent.click(within(ravi).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save members" }));
    await waitFor(() =>
      expect(api.workspaces.setMembers).toHaveBeenCalledWith("ws-1", ["u-sam", "u-ravi"]),
    );
  });
});

describe("admin brain keys tab", () => {
  it("shows a new key once, then only its prefix", async () => {
    api.workspaces.brainKeys.create.mockResolvedValue({
      id: "k-2",
      label: "Second",
      prefix: "nbk_zzzzzzzz",
      createdAt: "2026-10-16T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
      key: "nbk_zzzzzzzz-the-full-secret",
    });
    renderWithClient(<BrainKeysTab />);
    expect(await screen.findByText("nbk_abcdefgh…")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Key label"), { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByText("nbk_zzzzzzzz-the-full-secret")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy key/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("nbk_zzzzzzzz-the-full-secret")).toBeNull());
  });

  it("revokes only after confirming", async () => {
    api.workspaces.brainKeys.revoke.mockResolvedValue({});
    renderWithClient(<BrainKeysTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(api.workspaces.brainKeys.revoke).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(api.workspaces.brainKeys.revoke).toHaveBeenCalledWith("ws-1", "k-1"),
    );
  });
});

describe("settings defaults", () => {
  it("lets admins pick the default owner", async () => {
    renderWithClient(<DefaultsPanel workspace={WORKSPACE} />);
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Default owner" })).toHaveTextContent(
        "Sam Sales",
      ),
    );
  });

  it("shows salespeople the default owner read-only", async () => {
    session.role = "Salesperson";
    renderWithClient(<DefaultsPanel workspace={WORKSPACE} />);
    expect(screen.getByText("Sam Sales")).toBeInTheDocument();
    expect(screen.getByText("Set by an admin.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Default owner" })).toBeNull();
    expect(api.workspaces.members).not.toHaveBeenCalled(); // admin-only endpoint
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Meeting scheduled: email" })).toBeEnabled(),
    );
  });
});
