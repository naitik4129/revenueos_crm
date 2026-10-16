import { describe, expect, it } from "vitest";
import { pickWorkspaceId } from "./workspace-selection";

describe("pickWorkspaceId", () => {
  const list = [{ id: "a" }, { id: "b" }];

  it("keeps a saved workspace the user may still use", () => {
    expect(pickWorkspaceId(list, "b")).toBe("b");
  });

  it("drops a saved workspace that is no longer allowed and falls back to the first", () => {
    expect(pickWorkspaceId(list, "gone")).toBe("a");
    expect(pickWorkspaceId(list, null)).toBe("a");
  });

  it("is null when the user has no workspace", () => {
    expect(pickWorkspaceId([], "a")).toBeNull();
  });
});
