import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { preview } = vi.hoisted(() => ({ preview: vi.fn() }));

vi.mock("@/lib/backend-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend-client")>()),
  backend: { templates: { preview } },
}));
vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
}));
// The real pickers search the server; here a button picks a fixed record.
vi.mock("@/features/contacts/pickers", () => ({
  DealPicker: ({ onChange }: { onChange: (o: { id: string; label: string }) => void }) => (
    <button onClick={() => onChange({ id: "d-1", label: "Asha Rao" })}>Pick deal</button>
  ),
  ContactPicker: ({ onChange }: { onChange: (o: { id: string; label: string }) => void }) => (
    <button onClick={() => onChange({ id: "c-1", label: "Pat Prospect" })}>Pick contact</button>
  ),
}));

import { TemplatePreviewPanel } from "./template-preview-panel";

function renderPanel(type: "email" | "whatsapp", subject: string, body: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TemplatePreviewPanel type={type} subject={subject} body={body} />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  // Radix Select needs these in jsdom.
  Object.assign(window.HTMLElement.prototype, {
    hasPointerCapture: vi.fn(() => false),
    releasePointerCapture: vi.fn(),
    scrollIntoView: vi.fn(),
  });
});
beforeEach(() => preview.mockReset());
afterEach(cleanup);

describe("TemplatePreviewPanel", () => {
  it("highlights variables before anything is picked", () => {
    renderPanel("email", "Hi {{contact.firstName}}", "<p>x</p>");
    const subject = screen.getByLabelText("Preview subject");
    expect(within(subject).getByText("{{contact.firstName}}").tagName).toBe("MARK");
    expect(screen.getByText(/Pick a deal or contact/)).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });

  it("shows the deal's filled text and explains every unfilled token", async () => {
    preview.mockResolvedValue({
      subject: "Hi Asha",
      body: "<p>Rao Textiles {{contact.nickname}} {{meeting.date}}</p>",
      missing: [
        { token: "contact.nickname", reason: "unknown" },
        { token: "meeting.date", reason: "needs_meeting" },
      ],
      dealId: "d-1",
      meeting: null,
    });
    renderPanel(
      "email",
      "Hi {{contact.firstName}}",
      "<p>{{company.name}} {{contact.nickname}} {{meeting.date}}</p>",
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick deal" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Preview subject")).toHaveTextContent("Hi Asha"),
    );
    expect(preview).toHaveBeenCalledWith({
      subject: "Hi {{contact.firstName}}",
      body: "<p>{{company.name}} {{contact.nickname}} {{meeting.date}}</p>",
      dealId: "d-1",
    });
    const notFilled = screen.getByLabelText("Not filled");
    expect(notFilled).toHaveTextContent("{{contact.nickname}} — Not a variable");
    expect(notFilled).toHaveTextContent("{{meeting.date}} — Needs a meeting");
    const frame = screen.getByTitle("Email template preview") as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain(">{{contact.nickname}}</mark>");
  });

  it("previews a contact without a deal and flags deal variables (WhatsApp)", async () => {
    preview.mockResolvedValue({
      subject: null,
      body: "<p>Hi Pat, stage {{deal.stage}}</p>",
      missing: [{ token: "deal.stage", reason: "needs_deal" }],
      dealId: null,
      meeting: null,
    });
    renderPanel("whatsapp", "", "<p>Hi {{contact.firstName}}, stage {{deal.stage}}</p>");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Preview with" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Contact" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick contact" }));

    expect(await screen.findByLabelText("Not filled")).toHaveTextContent("Needs a deal");
    expect(preview).toHaveBeenCalledWith({
      body: "<p>Hi {{contact.firstName}}, stage {{deal.stage}}</p>",
      contactId: "c-1",
    });
    expect(screen.getByText(/Hi Pat, stage/)).toBeInTheDocument();
    expect(screen.getByText("{{deal.stage}}", { selector: "mark" })).toBeInTheDocument();
  });
});
