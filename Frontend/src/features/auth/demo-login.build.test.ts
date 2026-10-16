// @vitest-environment node
/**
 * The production build must not contain the demo login, even when VITE_DEMO_MODE=true is set
 * at build time. Runs the real `vite build` (as `npm run build` does) into a temp folder.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const frontendDir = fileURLToPath(new URL("../../..", import.meta.url));
const outDirs: string[] = [];
afterAll(() => outDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Builds the app and returns all emitted JS as one string. */
function buildBundle(mode: "production" | "development") {
  const outDir = mkdtempSync(join(tmpdir(), "crm-build-"));
  outDirs.push(outDir);
  // Production: like `npm run build` (no NODE_ENV). Development needs NODE_ENV=development:
  // `vite build --mode development` alone still builds with import.meta.env.DEV = false.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_ENV"));
  if (mode === "development") env["NODE_ENV"] = "development";
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "--outDir",
      outDir,
      "--emptyOutDir",
      "--logLevel",
      "error",
      "--mode",
      mode,
    ],
    {
      cwd: frontendDir,
      encoding: "utf8",
      env: {
        ...env,
        // The values a real production build gets as Docker build args (compose.yaml).
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_ANON_KEY: "anon",
        VITE_API_BASE_URL: "https://api.example.com",
        VITE_DEMO_MODE: "true",
      },
    },
  );
  expect(result.status, result.stderr.slice(0, 2000)).toBe(0);
  const assets = join(outDir, "assets");
  return readdirSync(assets)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(assets, f), "utf8"))
    .join("\n");
}

describe("demo login in builds", () => {
  it("is absent from the production build, even with VITE_DEMO_MODE=true", () => {
    const bundle = buildBundle("production");
    expect(bundle).toContain("Accounts are provisioned by your administrator"); // the login page is there
    // Plain booleans, so a failure does not print the whole bundle.
    expect(bundle.includes("data-demo-login")).toBe(false);
    expect(bundle.includes("Demo users")).toBe(false);
    expect(bundle.includes("sam@demo.local")).toBe(false);
  }, 120_000);

  it("is present in a development build, so the check above is meaningful", () => {
    expect(buildBundle("development").includes("data-demo-login")).toBe(true);
  }, 120_000);
});
