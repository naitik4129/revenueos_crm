import { afterEach, describe, expect, it, vi } from "vitest";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase-client", () => ({
  backendBaseUrl: "https://api.example.test",
  configurationError: null,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "session-token" } },
        error: null,
      })),
      signOut,
    },
  },
}));

import {
  BackendError,
  backend,
  getCurrentWorkspaceId,
  setCurrentWorkspaceId,
} from "./backend-client";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  signOut.mockClear();
  setCurrentWorkspaceId(null);
});

describe("backend client", () => {
  it.each([
    [
      "lead",
      () => backend.leads.create({ firstName: "Ada", company: "Northbeam", source: "referral" }),
      "POST",
      "/api/v1/leads",
    ],
    [
      "call",
      () => backend.leads.logCall("lead-1", { connected: false, notConnectedReason: "no_answer" }),
      "POST",
      "/api/v1/leads/lead-1/calls",
    ],
    [
      "task edit",
      () => backend.tasks.update("task-1", { dueAt: "2026-08-28T04:30:00.000Z" }),
      "PATCH",
      "/api/v1/tasks/task-1",
    ],
    [
      "meeting",
      () =>
        backend.meetings.create({
          leadId: "lead-1",
          title: "Discovery",
          at: "2026-08-28T04:30:00.000Z",
        }),
      "POST",
      "/api/v1/meetings",
    ],
    [
      "workflow publish",
      () => backend.workflows.publish("workflow-1", 3),
      "POST",
      "/api/v1/workflows/workflow-1/versions/3/publish",
    ],
    [
      "admin user",
      () =>
        backend.admin.users.create({
          name: "Ada Administered",
          email: "ada@example.com",
          password: "permanent-password",
        }),
      "POST",
      "/api/v1/admin/users",
    ],
    [
      "WhatsApp connect",
      () => backend.connections.whatsapp.command("connect"),
      "POST",
      "/api/v1/connections/whatsapp/connect",
    ],
    [
      "website lead owner update",
      () => backend.connections.websiteLeads.update({ defaultOwnerId: null }),
      "PUT",
      "/api/v1/connections/website-leads",
    ],
    [
      "workspace create",
      () => backend.workspaces.create("Second Brand"),
      "POST",
      "/api/v1/workspaces",
    ],
  ])("sends an authenticated %s request", async (_name, invoke, method, pathname) => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ id: "result-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await invoke();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.example.test${pathname}`);
    expect(init).toMatchObject({
      method,
      headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" },
    });
  });

  it("uploads a proposal document with its multipart fields", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ id: "proposal-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const document = new File(["proposal contents"], "proposal.pdf", { type: "application/pdf" });
    await backend.proposals.create({
      leadId: "lead-1",
      title: "Proposal",
      emailTemplateId: "template-email-1",
      whatsappTemplateId: "template-whatsapp-1",
      document,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/api/v1/proposals");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer session-token" });
    expect(init?.headers).not.toHaveProperty("Content-Type");
    const body = init?.body as FormData;
    expect(body.get("leadId")).toBe("lead-1");
    expect(body.get("title")).toBe("Proposal");
    expect(body.get("emailTemplateId")).toBe("template-email-1");
    expect(body.get("whatsappTemplateId")).toBe("template-whatsapp-1");
    expect(body.get("document")).toBe(document);
  });

  it("omits retained email secrets from a connections update", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ provider: "resend" }));
    vi.stubGlobal("fetch", fetchMock);

    await backend.connections.email.update({
      provider: "resend",
      enabled: true,
      senderName: "Northbeam",
      senderAddress: "sales@example.com",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("resendApiKey");
    expect(body).not.toHaveProperty("smtpPassword");
  });

  it("attaches X-Workspace-Id once a workspace is selected, and omits it before then", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await backend.leads.list();
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty(["headers", "X-Workspace-Id"]);

    setCurrentWorkspaceId("workspace-1");
    expect(getCurrentWorkspaceId()).toBe("workspace-1");
    await backend.leads.list();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { "X-Workspace-Id": "workspace-1" },
    });
  });

  it("normalizes API errors and clears an unauthorized local session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          {
            error: {
              code: "invalid_session",
              message: "Session expired",
              details: { retry: false },
            },
          },
          401,
        ),
      ),
    );

    await expect(backend.me()).rejects.toEqual(
      expect.objectContaining<Partial<BackendError>>({
        status: 401,
        code: "invalid_session",
        message: "Session expired",
      }),
    );
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
