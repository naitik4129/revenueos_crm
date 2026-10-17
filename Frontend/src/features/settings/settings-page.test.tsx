import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EmailConnection,
  GoogleCalendarConnection,
  WhatsAppConnection,
} from "@/lib/backend-client";
import { calendarStatus, emailStatus, whatsappStatus } from "./connection-status";

const email = (patch: Partial<EmailConnection> = {}) =>
  ({
    provider: "resend",
    enabled: true,
    senderName: "Acme",
    senderAddress: "hi@acme.test",
    smtpHost: "",
    smtpPort: 587,
    smtpSecurity: "starttls",
    resendApiKeyConfigured: true,
    smtpUsernameConfigured: false,
    smtpPasswordConfigured: false,
    environmentFallbackConfigured: false,
    source: "database",
    updatedAt: "",
    ...patch,
  }) as EmailConnection;
const whatsapp = (patch: Partial<WhatsAppConnection> = {}) =>
  ({
    enabled: true,
    status: "disconnected",
    displayName: null,
    connectedPhone: null,
    qr: null,
    lastError: null,
    outboundRestricted: false,
    todayCount: 0,
    dailyCap: 200,
    pendingCount: 0,
    invalidPhoneCount: 0,
    workerHeartbeatAt: null,
    inboundReview: [],
    ...patch,
  }) as WhatsAppConnection;
const calendar = (patch: Partial<GoogleCalendarConnection> = {}) =>
  ({
    configured: true,
    platformConfigured: true,
    usesOwnCredentials: false,
    status: "disconnected",
    connectedEmail: null,
    lastError: null,
    clientSecretConfigured: false,
    ...patch,
  }) as GoogleCalendarConnection;

describe("connection status", () => {
  it("email: connected only with a provider key and sending on", () => {
    expect(emailStatus(email()).state).toBe("connected");
    expect(emailStatus(email({ enabled: false })).state).toBe("not_connected");
    expect(emailStatus(email({ resendApiKeyConfigured: false })).state).toBe("not_connected");
    expect(emailStatus(email({ provider: "smtp", smtpHost: "smtp.x" })).state).toBe(
      "not_connected",
    );
  });

  it("whatsapp: errors, restrictions, pairing and connected read differently", () => {
    expect(whatsappStatus(whatsapp()).state).toBe("not_connected");
    expect(whatsappStatus(whatsapp({ status: "qr_ready" })).state).toBe("pending");
    expect(whatsappStatus(whatsapp({ status: "reauth_required" })).state).toBe("error");
    expect(whatsappStatus(whatsapp({ status: "connected", outboundRestricted: true })).state).toBe(
      "error",
    );
    expect(whatsappStatus(whatsapp({ status: "connected", displayName: "Acme" }))).toEqual({
      state: "connected",
      text: "Acme.",
    });
  });

  it("calendar: asks for credentials when none are configured", () => {
    expect(calendarStatus(calendar({ configured: false })).text).toBe(
      "Add OAuth credentials first.",
    );
    expect(calendarStatus(calendar({ status: "connected", connectedEmail: "a@x" })).state).toBe(
      "connected",
    );
    expect(calendarStatus(calendar({ status: "error", lastError: "expired" })).text).toBe(
      "expired",
    );
  });
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/backend-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend-client")>()),
  backend: {
    connections: {
      email: { get: vi.fn(async () => email()) },
      whatsapp: { get: vi.fn(async () => whatsapp({ status: "error", lastError: "boom" })) },
      googleCalendar: { get: vi.fn(async () => calendar()) },
    },
  },
}));
vi.mock("@/store", () => ({
  useSession: () => ({
    currentUser: { id: "u1", name: "Sam Sales", email: "sam@demo.local", role: "Salesperson" },
  }),
}));
vi.mock("@/store/workspace-context", () => ({
  useWorkspace: () => ({ currentWorkspace: { id: "w1", name: "Acme" }, isLoading: false }),
}));
vi.mock("./defaults-panel", () => ({ DefaultsPanel: () => <div>defaults panel</div> }));

import { WorkspaceSettingsPage } from "./workspace-settings-page";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkspaceSettingsPage />
    </QueryClientProvider>,
  );
}
const nav = () => within(screen.getByRole("navigation", { name: "Settings sections" }));

describe("WorkspaceSettingsPage", () => {
  it("shows one section at a time and marks each connection's state in the nav", async () => {
    renderPage();
    expect(screen.getByText("defaults panel")).toBeVisible();
    expect(await nav().findByLabelText("Connected")).toBeInTheDocument(); // email
    expect(await nav().findByLabelText("Error")).toBeInTheDocument(); // whatsapp
    expect(await nav().findByLabelText("Not connected")).toBeInTheDocument(); // calendar

    fireEvent.click(nav().getByRole("button", { name: /Profile/ }));
    expect(screen.getByText("defaults panel")).not.toBeVisible();
    expect(screen.getByText("sam@demo.local")).toBeVisible();
    expect(nav().getByRole("button", { name: /Profile/ })).toHaveAttribute("aria-current", "page");
  });

  it("opens Google Calendar when the OAuth redirect lands on ?calendar=", () => {
    window.history.replaceState(null, "", "/settings?calendar=connected");
    renderPage();
    expect(nav().getByRole("button", { name: /Google Calendar/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
