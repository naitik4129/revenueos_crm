import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "@/lib/backend-client";
import type { Contact, LogCallResult } from "@/types";

const api = vi.hoisted(() => ({ merge: vi.fn(), logCall: vi.fn() }));
vi.mock("@/lib/backend-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/backend-client")>();
  return {
    ...actual,
    backend: { ...actual.backend, contacts: { ...actual.backend.contacts, ...api } },
  };
});
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  // The log-call result links to the deal; no router in this test.
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
// The real picker searches the server; here a button picks a fixed contact.
vi.mock("./pickers", () => ({
  ContactPicker: ({ onChange }: { onChange: (o: { id: string; label: string }) => void }) => (
    <button onClick={() => onChange({ id: "target", label: "Ann" })}>pick target</button>
  ),
}));

import { MergeDialog } from "./contact-dialogs";
import { LogCallDialog } from "./log-call-dialog";

const contact = { id: "c1", firstName: "Bob", lastName: "Lee", doNotContact: false } as Contact;

function wrap(children: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>);
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MergeDialog", () => {
  it("shows the backend's 409 reason inside the dialog", async () => {
    api.merge.mockRejectedValue(
      new BackendError(
        409,
        "conflict",
        "Both contacts have an open deal. Close or park one of the deals before merging.",
      ),
    );
    wrap(<MergeDialog contact={contact} open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByText("pick target"));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Both contacts have an open deal");
    expect(api.merge).toHaveBeenCalledWith("c1", "target", undefined);
  });
});

describe("LogCallDialog", () => {
  it("shows the new deal the call opened", async () => {
    api.logCall.mockResolvedValue({
      call: {
        id: "k1",
        source: "human",
        connected: false,
        notConnectedReason: "no_answer",
        at: "",
      },
      contact,
      deal: {
        id: "d-new",
        stage: "not_connected_nurture",
        automationMode: "active",
        nextAction: null,
      },
    } as unknown as LogCallResult);
    wrap(
      <LogCallDialog contact={contact} dealIds={["d-old"]} open onOpenChange={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Not connected" }));
    fireEvent.click(screen.getByRole("button", { name: "Save call" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Opened a new deal");
    expect(api.logCall).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ connected: false, notConnectedReason: "no_answer" }),
    );
  });
});
