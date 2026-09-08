import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
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

vi.mock("@/features/automations/template-body-editor", () => ({
  TemplateBodyEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (html: string) => void;
  }) => (
    <textarea
      aria-label="Body editor"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

vi.mock("@/store", () => ({
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
  useAutomations: () => storeState.current,
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
  return render(<RouterProvider router={router} />);
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
  it.each([
    ["Lead first name", "lead.firstName"],
    ["Current date", "current.date"],
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
