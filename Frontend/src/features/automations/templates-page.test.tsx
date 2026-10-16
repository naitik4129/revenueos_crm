import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { storeState } = vi.hoisted(() => ({
  storeState: { current: undefined as unknown },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
  useAutomations: () => storeState.current,
  // A slice of GET /templates/variables, one per group.
  useTemplateVariables: () => [
    { token: "contact.firstName", label: "First name", group: "contact" },
    { token: "company.name", label: "Company name", group: "company" },
    { token: "deal.stage", label: "Deal stage", group: "deal" },
    { token: "meeting.date", label: "Meeting date", group: "meeting" },
    { token: "meeting.time", label: "Meeting time", group: "meeting" },
    { token: "current.date", label: "Today's date", group: "date" },
    { token: "tomorrow.date", label: "Tomorrow's date", group: "date" },
    { token: "current.time", label: "Current time", group: "date" },
  ],
}));

import { TemplatesPage } from "./templates-page";

const originalScrollTo = window.scrollTo;

async function renderTemplatesPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/automations/templates",
    component: TemplatesPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screenRoute]),
    history: createMemoryHistory({ initialEntries: ["/automations/templates"] }),
  });
  await router.load();
  // The Preview tab fetches the filled text, so the page needs a query client.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  Object.defineProperty(window.HTMLElement.prototype, "hasPointerCapture", {
    value: vi.fn(() => false),
    writable: true,
  });
  Object.defineProperty(window.HTMLElement.prototype, "releasePointerCapture", {
    value: vi.fn(),
    writable: true,
  });
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    writable: true,
  });
});

beforeEach(() => {
  storeState.current = {
    templates: [],
    isLoading: false,
    error: null,
    isPending: false,
    addTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    uploadTemplateAttachment: vi.fn(),
    deleteTemplateAttachment: vi.fn(),
  };
});

afterEach(cleanup);

afterAll(() => {
  Object.defineProperty(window, "scrollTo", { value: originalScrollTo, writable: true });
});

describe("TemplatesPage", () => {
  it("groups the variable picker as Contact / Company / Deal / Meeting / Date", async () => {
    await renderTemplatesPage();
    fireEvent.click(screen.getByRole("button", { name: /new template/i }));
    fireEvent.keyDown(screen.getByLabelText("Insert subject variable"), { key: "ArrowDown" });
    await screen.findByRole("option", { name: "First name" });
    const headings = [
      "Contact",
      "Company",
      "Deal",
      "Meeting (Meeting Scheduled templates only)",
      "Date",
    ];
    for (const heading of headings) expect(screen.getByText(heading)).toBeInTheDocument();
  });

  it.each([
    ["First name", "contact.firstName"],
    ["Company name", "company.name"],
    ["Deal stage", "deal.stage"],
    ["Today's date", "current.date"],
    ["Tomorrow's date", "tomorrow.date"],
    ["Current time", "current.time"],
    ["Meeting time", "meeting.time"],
    ["Meeting date", "meeting.date"],
  ])("inserts %s into the email subject", async (label, token) => {
    await renderTemplatesPage();

    fireEvent.click(screen.getByRole("button", { name: /new template/i }));

    const subjectInput = screen.getByLabelText("Subject") as HTMLInputElement;
    fireEvent.change(subjectInput, { target: { value: "Hi " } });
    subjectInput.focus();
    subjectInput.setSelectionRange(3, 3);

    const variableSelect = screen.getByLabelText("Insert subject variable");
    variableSelect.focus();
    fireEvent.keyDown(variableSelect, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: label }));

    await waitFor(() => {
      expect(subjectInput).toHaveValue(`Hi {{${token}}}`);
    });
  });
});

const design =
  '<!doctype html><html><head><style>.email {color:red}</style></head><body><table class="email"><tr><td>{{contact.firstName}}<img src="https://example.com/image.png"></td></tr></table></body></html>';
function existingTemplate() {
  return {
    id: "email-1",
    name: "Designed email",
    type: "email",
    subject: "Hello",
    body: design,
    active: true,
    attachments: [],
    isDefaultMeetingScheduled: false,
  };
}
function state() {
  return storeState.current as {
    templates: ReturnType<typeof existingTemplate>[];
    updateTemplate: ReturnType<typeof vi.fn>;
  };
}
function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
}

it("preserves complete HTML through preview, cancelled conversion, save and reopen", async () => {
  const template = existingTemplate();
  state().templates = [template];
  state().updateTemplate.mockResolvedValue(template);
  await renderTemplatesPage();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("HTML source")).toHaveValue(design);
  selectTab("Preview");
  const frame = screen.getByTitle("Email template preview");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame.getAttribute("srcdoc")).toContain(".email {color:red}");
  selectTab("Visual");
  const confirmation = screen.getByRole("dialog", { name: "Convert to visual editor?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  selectTab("HTML");
  expect(screen.getByLabelText("HTML source")).toHaveValue(design);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(state().updateTemplate).toHaveBeenCalledWith(
      "email-1",
      expect.objectContaining({ body: design }),
    ),
  );
  await waitFor(() => expect(screen.queryByLabelText("HTML source")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("HTML source")).toHaveValue(design);
});

it("keeps edited HTML on a failed save", async () => {
  state().templates = [existingTemplate()];
  state().updateTemplate.mockRejectedValue(new Error("Offline"));
  await renderTemplatesPage();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const edited = design.replace("color:red", "color:blue");
  fireEvent.change(screen.getByLabelText("HTML source"), { target: { value: edited } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  expect(screen.getByLabelText("HTML source")).toHaveValue(edited);
});

it("converts HTML only after confirmation", async () => {
  state().templates = [existingTemplate()];
  await renderTemplatesPage();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  selectTab("Visual");
  fireEvent.click(screen.getByRole("button", { name: "Convert" }));
  expect(screen.getByRole("tab", { name: "Visual" })).toHaveAttribute("aria-selected", "true");
  selectTab("HTML");
  const source = screen.getByLabelText("HTML source") as HTMLTextAreaElement;
  expect(source.value).toContain("{{contact.firstName}}");
  expect(source.value).not.toMatch(/<table|<img|<style/);
});

it("inserts HTML variables at the cursor and confirms conversion when switching to WhatsApp", async () => {
  await renderTemplatesPage();
  fireEvent.click(screen.getByRole("button", { name: /new template/i }));
  expect(screen.getByRole("tab", { name: "Visual" })).toHaveAttribute("aria-selected", "true");
  selectTab("HTML");
  const source = screen.getByLabelText("HTML source") as HTMLTextAreaElement;
  fireEvent.change(source, { target: { value: "<p>Hello </p>" } });
  source.setSelectionRange(9, 9);
  const picker = screen.getByLabelText("Insert HTML variable");
  fireEvent.keyDown(picker, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "First name" }));
  expect(source).toHaveValue("<p>Hello {{contact.firstName}}</p>");
  const channel = screen.getAllByRole("combobox").find((node) => node.textContent === "Email")!;
  fireEvent.keyDown(channel, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "WhatsApp" }));
  const confirmation = screen.getByRole("dialog", { name: "Convert to visual editor?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("HTML source")).toHaveValue("<p>Hello {{contact.firstName}}</p>");
  fireEvent.keyDown(channel, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "WhatsApp" }));
  fireEvent.click(screen.getByRole("button", { name: "Convert" }));
  expect(screen.queryByRole("tab", { name: "HTML" })).not.toBeInTheDocument();
});
