import { describe, expect, it } from "vitest";
import { laterTodayIst } from "./time.js";

describe("laterTodayIst", () => {
  it("is 23:30 IST the same IST day while that is still ahead", () => {
    // 10:00 IST = 04:30 UTC.
    expect(laterTodayIst(new Date("2026-10-16T04:30:00Z"))).toBe("2026-10-16T18:00:00.000Z");
    // 01:00 IST on the 17th is still the 16th in UTC; the meeting is the 17th, 23:30 IST.
    expect(laterTodayIst(new Date("2026-10-16T19:30:00Z"))).toBe("2026-10-17T18:00:00.000Z");
  });

  it("falls back to 23:59 IST after 23:30", () => {
    // 23:45 IST = 18:15 UTC.
    expect(laterTodayIst(new Date("2026-10-16T18:15:00Z"))).toBe("2026-10-16T18:29:00.000Z");
  });
});
