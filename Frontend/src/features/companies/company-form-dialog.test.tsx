import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "@/lib/backend-client";

const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/backend-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/backend-client")>();
  return {
    ...actual,
    backend: { ...actual.backend, companies: { ...actual.backend.companies, ...api } },
  };
});
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store")>()),
  useSession: () => ({ users: [], currentUser: null }),
}));

import { CompanyFormDialog } from "./company-form-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CompanyFormDialog open onOpenChange={() => undefined} />
    </QueryClientProvider>,
  );
  const input = (name: string) => screen.getByText(name).parentElement!.querySelector("input")!;
  return { input };
}

describe("CompanyFormDialog", () => {
  it("fills the domain from the website and shows a duplicate domain under Domain", async () => {
    api.create.mockRejectedValue(
      new BackendError(
        409,
        "conflict",
        "A company with this domain already exists in this workspace.",
        {
          field: "domain",
        },
      ),
    );
    const { input } = renderDialog();
    fireEvent.change(input("Name"), { target: { value: "Acme" } });
    fireEvent.change(input("Website"), { target: { value: "https://www.Acme.com/about" } });
    expect(input("Domain")).toHaveValue("acme.com");

    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    expect(await screen.findByText(/domain already exists/)).toBeInTheDocument();
    expect(screen.getByText(/domain already exists/).parentElement).toContainElement(
      input("Domain"),
    );
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme", domain: "acme.com" }),
    );
  });

  it("stops following the website once a domain is typed", () => {
    const { input } = renderDialog();
    fireEvent.change(input("Domain"), { target: { value: "acme.io" } });
    fireEvent.change(input("Website"), { target: { value: "https://other.com" } });
    expect(input("Domain")).toHaveValue("acme.io");
  });

  it("requires a name before saving", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    expect(await screen.findByText("Company name is required.")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });
});
