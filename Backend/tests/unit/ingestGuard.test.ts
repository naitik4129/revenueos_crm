import { describe, expect, it } from "vitest";
import { createFixedWindowLimiter, ingestKeysMatch } from "../../src/security/ingestGuard.js";

describe("ingestKeysMatch", () => {
  const key = "k".repeat(40);

  it("accepts the exact key", () => {
    expect(ingestKeysMatch(key, key)).toBe(true);
  });

  it("rejects missing, empty, shorter, longer and different keys", () => {
    expect(ingestKeysMatch(undefined, key)).toBe(false);
    expect(ingestKeysMatch("", key)).toBe(false);
    expect(ingestKeysMatch("k".repeat(39), key)).toBe(false);
    expect(ingestKeysMatch("k".repeat(41), key)).toBe(false);
    expect(ingestKeysMatch("j".repeat(40), key)).toBe(false);
  });
});

describe("createFixedWindowLimiter", () => {
  it("allows up to max calls per window, then reports seconds to wait", () => {
    let t = 1_000;
    const limiter = createFixedWindowLimiter({ max: 2, windowMs: 60_000, now: () => t });
    expect(limiter.check()).toBe(0);
    expect(limiter.check()).toBe(0);
    expect(limiter.check()).toBe(60);
    t += 30_000;
    expect(limiter.check()).toBe(30);
  });

  it("resets after the window", () => {
    let t = 0;
    const limiter = createFixedWindowLimiter({ max: 1, windowMs: 1_000, now: () => t });
    expect(limiter.check()).toBe(0);
    expect(limiter.check()).toBeGreaterThan(0);
    t += 1_000;
    expect(limiter.check()).toBe(0);
  });
});
