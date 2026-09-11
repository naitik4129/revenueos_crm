import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplateBodyEditor } from "./template-body-editor";

afterEach(cleanup);

describe("TemplateBodyEditor", () => {
  it("inserts a normalized http link into the saved HTML", async () => {
    const onChange = vi.fn();
    render(<TemplateBodyEditor value="" onChange={onChange} loadKey="new" />);

    fireEvent.click(screen.getByRole("button", { name: /insert link/i }));
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "example.com/demo" } });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "View demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('href="https://example.com/demo"'),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('style="color: rgb(37, 99, 235);"'),
      );
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining(">View demo</a>"));
    });
  });
});
