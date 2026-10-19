import { describe, expect, it } from "vitest";
import { toIsoFromIst } from "./dates";
import { countLabel, relShort, tabLabel } from "./format";
import { label, timelineTitle, workflowTriggerLabel } from "./labels";

describe("presentation helpers", () => {
  it("transports an IST form value as UTC", () => {
    expect(toIsoFromIst("2026-08-27", "10:30:00")).toBe("2026-08-27T05:00:00.000Z");
  });

  it("keeps backend enum values separate from friendly labels", () => {
    expect(label("proposal_pending")).toBe("Proposal Pending");
    expect(label("ready_for_first_call")).toBe("Ready for First Call");
    expect(label("no_show")).toBe("No-show");
    expect(label(null)).toBe("-");
    expect(label("interested_later")).toBe("Interested - Later");
  });

  it("labels meeting-agreed workflow triggers as call outcomes", () => {
    expect(label("meeting_agreed")).toBe("Meeting Agreed");
    expect(workflowTriggerLabel("meeting_agreed")).toBe("Call Outcome = Meeting Agreed");
  });
});

describe("timelineTitle", () => {
  it("rewrites raw backend titles in plain words", () => {
    expect(timelineTitle("Absorbed Duplicate Contact")).toBe(
      "A duplicate contact was merged into this one",
    );
    expect(timelineTitle("Note Added")).toBe("Note added");
    expect(timelineTitle("WhatsApp Sent (dry run)")).toBe("WhatsApp sent (dry run)");
    expect(timelineTitle("Automation Step Failed - Retry Scheduled")).toBe(
      "Automation step failed - retry scheduled",
    );
    expect(timelineTitle("Lifecycle: qualified -> contacted (moved back)")).toBe(
      "Lifecycle stage changed from Qualified to Contacted (moved back)",
    );
    expect(timelineTitle("Lifecycle: engaged")).toBe("Lifecycle stage set to Engaged");
    expect(timelineTitle("Stage changed to proposal_sent")).toBe(
      "Deal stage changed to Proposal Sent",
    );
    expect(timelineTitle("email contactability: bounced")).toBe("Email marked bounced");
  });
});

describe("list labels", () => {
  it("counts with the right plural", () => {
    expect(countLabel(1, "contact")).toBe("1 contact");
    expect(countLabel(1200, "company", "companies")).toBe("1,200 companies");
  });

  it("shortens older dates to days ago and keeps today/tomorrow wording", () => {
    const day = 86_400_000;
    expect(relShort(new Date(Date.now() - 5 * day).toISOString())).toBe("5d ago");
    expect(relShort(new Date().toISOString())).toMatch(/^Today, /);
    expect(relShort(undefined)).toBe("-");
  });
});

describe("tabLabel", () => {
  it("adds the status count, the total on All, and nothing while loading", () => {
    const counts = { sent: 3, draft: 2 };
    expect(tabLabel("Sent", counts, "sent")).toBe("Sent (3)");
    expect(tabLabel("Rejected", counts, "rejected")).toBe("Rejected (0)");
    expect(tabLabel("All", counts, "all")).toBe("All (5)");
    expect(tabLabel("Sent", undefined, "sent")).toBe("Sent");
  });
});
