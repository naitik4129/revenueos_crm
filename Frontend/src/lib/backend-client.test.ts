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

import { BackendError, backend } from "./backend-client";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  signOut.mockClear();
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
      "proposal",
      () => backend.proposals.create({ leadId: "lead-1", title: "Proposal" }),
      "POST",
      "/api/v1/proposals",
    ],
    [
      "workflow publish",
      () => backend.workflows.publish("workflow-1", 3),
      "POST",
      "/api/v1/workflows/workflow-1/versions/3/publish",
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
