import { describe, expect, it } from "vitest";
import { adminPathRedirect } from "./admin-gate";

describe("adminPathRedirect", () => {
  it.each(["admin", "salesperson"] as const)(
    "forwards the calendar OAuth landing to /settings for a %s",
    (role) => {
      expect(adminPathRedirect("?calendar=connected", role)).toBe("/settings?calendar=connected");
      expect(adminPathRedirect("?calendar=error&message=Denied", role)).toBe(
        "/settings?calendar=error&message=Denied",
      );
    },
  );

  it("keeps admins on /admin and sends salespeople home", () => {
    expect(adminPathRedirect("", "admin")).toBeNull();
    expect(adminPathRedirect("", "salesperson")).toBe("/");
  });
});
