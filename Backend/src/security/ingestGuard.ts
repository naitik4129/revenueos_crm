import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a presented ingest key against the configured
 * one. Both sides are hashed first so the comparison is always over two
 * equal-length buffers (timingSafeEqual throws on length mismatch, and the
 * raw lengths must not leak either).
 */
export function ingestKeysMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface FixedWindowLimiter {
  /** Returns 0 when the call is allowed, otherwise the seconds until the window resets. */
  check(): number;
}

/**
 * Minimal in-process fixed-window limiter. Sufficient here because exactly
 * one caller (the website server) holds the key and the API runs as a single
 * instance; per-visitor throttling belongs on the website itself.
 */
export function createFixedWindowLimiter(options: { max: number; windowMs: number; now?: () => number }): FixedWindowLimiter {
  const now = options.now ?? Date.now;
  let windowStart = now();
  let count = 0;
  return {
    check() {
      const t = now();
      if (t - windowStart >= options.windowMs) {
        windowStart = t;
        count = 0;
      }
      if (count >= options.max) return Math.max(1, Math.ceil((windowStart + options.windowMs - t) / 1000));
      count += 1;
      return 0;
    },
  };
}
