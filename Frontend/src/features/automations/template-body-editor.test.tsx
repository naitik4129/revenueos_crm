import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TemplateBodyEditor } from "./template-body-editor";

beforeAll(() => {
  // jsdom has no layout; ProseMirror asks Range for geometry when focusing.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

describe("TemplateBodyEditor", () => {
  it("inserts a normalized http link into the saved HTML", async () => {
    const onChange = vi.fn();
    render(<TemplateBodyEditor variables={[]} value="" onChange={onChange} loadKey="new" />);

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

it("does not emit content updates when loading or disabling the editor", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <TemplateBodyEditor variables={[]} value="Legacy text" onChange={onChange} loadKey="one" />,
  );
  rerender(
    <TemplateBodyEditor
      variables={[]}
      value="Other text"
      onChange={onChange}
      loadKey="two"
      disabled
    />,
  );
  expect(onChange).not.toHaveBeenCalled();
});

it.each([
  ["Bullet list", "ul"],
  ["Numbered list", "ol"],
])("toggles %s and updates toolbar state", async (label, tag) => {
  const onChange = vi.fn();
  const { container } = render(
    <TemplateBodyEditor variables={[]} value="<p>First</p>" onChange={onChange} loadKey="new" />,
  );
  const button = screen.getByRole("button", { name: label });
  fireEvent.click(button);
  await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
  expect(container.querySelector(`${tag} > li`)).toHaveTextContent("First");
  expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining(`<${tag}>`));
  fireEvent.click(button);
  await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  expect(container.querySelector(tag)).toBeNull();
});

it("adds a list item with Enter and nests it with Tab", async () => {
  const { container } = render(
    <TemplateBodyEditor variables={[]} value="<p>First</p>" onChange={vi.fn()} loadKey="keys" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
  const content = container.querySelector('[contenteditable="true"]')!;
  fireEvent.keyDown(content, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(container.querySelectorAll("ul > li")).toHaveLength(2));
  fireEvent.keyDown(content, { key: "Tab", code: "Tab" });
  await waitFor(() => expect(container.querySelector("ul > li > ul > li")).not.toBeNull());
  fireEvent.keyDown(content, { key: "Tab", code: "Tab", shiftKey: true });
  await waitFor(() => expect(container.querySelector("ul > li > ul")).toBeNull());
});
