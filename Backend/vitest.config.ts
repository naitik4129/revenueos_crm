import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // demo/ and load/ tests live beside their code: tests/ is compiled into dist, demo/ and load/ must not be.
    include: ["tests/**/*.test.ts", "demo/**/*.test.ts", "load/**/*.test.ts"],
    setupFiles: ["./tests/setup-env.ts"],
  },
});
