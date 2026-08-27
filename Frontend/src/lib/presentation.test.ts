import { describe, expect, it } from "vitest";
import { toIsoFromIst } from "./dates";
import { label } from "./labels";

describe("presentation helpers", () => {
  it("transports an IST form value as UTC", () => {
    expect(toIsoFromIst("2026-08-27", "10:30:00")).toBe("2026-08-27T05:00:00.000Z");
  });

  it("keeps backend enum values separate from friendly labels", () => {
    expect(label("proposal_pending")).toBe("Proposal Pending");
    expect(label("ready_for_first_call")).toBe("Ready for First Call");
    expect(label("no_show")).toBe("No-show");
  });
});
