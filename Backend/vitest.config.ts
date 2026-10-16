import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // demo/ tests live beside the demo code: tests/ is compiled into dist, demo/ must not be.
    include: ["tests/**/*.test.ts", "demo/**/*.test.ts"],
    setupFiles: ["./tests/setup-env.ts"],
  },
});
