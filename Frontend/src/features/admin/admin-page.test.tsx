import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { api, session } = vi.hoisted(() => ({
  api: {
    admin: {
      users: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
      sending: { get: vi.fn(), update: vi.fn() },
    },
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
import { AdminPage } from "./admin-page";
import { SendingTab } from "./sending-tab";
import type { SendPolicy } from "@/lib/backend-client";

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
  // Radix Checkbox measures itself.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
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
  api.admin.sending.get.mockResolvedValue({ email: EMAIL_POLICY, whatsapp: WHATSAPP_POLICY });
});

const EMAIL_POLICY: SendPolicy = {
  channel: "email",
  paused: false,
  pauseReason: null,
  pausedAt: null,
  dailyCap: 50,
  safeMaxDailyCap: 500,
  rampStart: 20,
  rampStepPerDay: 5,
  rampStartedAt: "2026-10-19T04:00:00.000Z",
  rampDay: 3,
  todayCap: 30,
  sentToday: 12,
  minGapSeconds: 60,
  maxGapSeconds: 180,
  windowStart: "09:00",
  windowEnd: "19:00",
  windowDays: [1, 2, 3, 4, 5],
  nextSendAt: null,
  updatedAt: "2026-10-21T04:00:00.000Z",
};
const WHATSAPP_POLICY: SendPolicy = {
  ...EMAIL_POLICY,
  channel: "whatsapp",
  paused: true,
  pauseReason: "WhatsApp has applied a reachout or new-chat restriction.",
  pausedAt: "2026-10-21T05:00:00.000Z",
  dailyCap: 60,
  safeMaxDailyCap: 250,
  rampStartedAt: null,
  rampDay: null,
  todayCap: 20,
  sentToday: 0,
  minGapSeconds: 45,
  maxGapSeconds: 120,
};

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

describe("admin page tabs", () => {
  it("shows one tab at a time, starting on Users", async () => {
    renderWithClient(<AdminPage />);
    expect(screen.getByRole("tab", { name: "Users" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Ravi Former")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Brain API keys" }));
    expect(await screen.findByText("nbk_abcdefgh…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give CRM access" })).toBeNull();
  });
});

describe("admin sending tab", () => {
  const card = async (name: string) => within(await screen.findByRole("region", { name }));

  it("shows today's sends against the cap, the ramp day and why a channel is paused", async () => {
    renderWithClient(<SendingTab />);
    const email = await card("Email sending");
    expect(email.getByText("12 / 30")).toBeInTheDocument();
    expect(email.getByText("Day 3")).toBeInTheDocument();
    expect(email.getByText("Sending")).toBeInTheDocument();
    const whatsapp = await card("WhatsApp sending");
    expect(whatsapp.getAllByText("Paused")).toHaveLength(2); // the badge and the notice
    expect(
      whatsapp.getByText(/WhatsApp has applied a reachout or new-chat restriction./),
    ).toBeInTheDocument();
    expect(whatsapp.getByText("Not started (starts at the first send)")).toBeInTheDocument();
    expect(whatsapp.getByRole("button", { name: "Restart warm-up" })).toBeDisabled();
    expect(api.admin.sending.get).toHaveBeenCalledWith("ws-1", expect.anything());
  });

  it("saves every field of a channel", async () => {
    api.admin.sending.update.mockResolvedValue({ ...EMAIL_POLICY, dailyCap: 80 });
    renderWithClient(<SendingTab />);
    const email = await card("Email sending");
    fireEvent.change(email.getByLabelText("Daily cap (max 500)"), { target: { value: "80" } });
    fireEvent.change(email.getByLabelText("To (IST)"), { target: { value: "18:30" } });
    fireEvent.click(email.getByRole("checkbox", { name: "Sat" }));
    fireEvent.click(email.getByRole("checkbox", { name: "Mon" }));
    fireEvent.click(email.getByRole("button", { name: "Save Email" }));
    await waitFor(() =>
      expect(api.admin.sending.update).toHaveBeenCalledWith("ws-1", "email", {
        dailyCap: 80,
        rampStart: 20,
        rampStepPerDay: 5,
        minGapSeconds: 60,
        maxGapSeconds: 180,
        windowStart: "09:00",
        windowEnd: "18:30",
        windowDays: [2, 3, 4, 5, 6],
      }),
    );
  });

  it("won't save a min gap above the max gap or no sending days", async () => {
    renderWithClient(<SendingTab />);
    const email = await card("Email sending");
    fireEvent.change(email.getByLabelText("Min gap (s)"), { target: { value: "300" } });
    expect(email.getByText("Min gap can't be above the max gap.")).toBeInTheDocument();
    expect(email.getByRole("button", { name: "Save Email" })).toBeDisabled();
    fireEvent.change(email.getByLabelText("Min gap (s)"), { target: { value: "60" } });
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"])
      fireEvent.click(email.getByRole("checkbox", { name: day }));
    expect(email.getByRole("button", { name: "Save Email" })).toBeDisabled();
  });

  it("pauses with a reason and resumes", async () => {
    api.admin.sending.update.mockImplementation(
      async (_ws: string, channel: string, patch: object) => ({
        ...(channel === "email" ? EMAIL_POLICY : WHATSAPP_POLICY),
        ...patch,
      }),
    );
    renderWithClient(<SendingTab />);
    const email = await card("Email sending");
    expect(email.getByRole("button", { name: "Pause" })).toBeDisabled();
    fireEvent.change(email.getByLabelText("Reason to pause Email"), {
      target: { value: " Domain check " },
    });
    fireEvent.click(email.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(api.admin.sending.update).toHaveBeenCalledWith("ws-1", "email", {
        paused: true,
        pauseReason: "Domain check",
      }),
    );
    fireEvent.click(
      (await card("WhatsApp sending")).getByRole("button", { name: "Resume WhatsApp" }),
    );
    await waitFor(() =>
      expect(api.admin.sending.update).toHaveBeenCalledWith("ws-1", "whatsapp", { paused: false }),
    );
  });

  it("is a tab on the admin page", async () => {
    renderWithClient(<AdminPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Sending" }));
    expect(await screen.findByRole("region", { name: "Email sending" })).toBeInTheDocument();
  });
});
