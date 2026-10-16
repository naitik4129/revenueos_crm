/** Demo mode must never reach real data, real providers or a production build. */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoRuntimeError, demoStartError } from "./guards.js";

const backendDir = fileURLToPath(new URL("..", import.meta.url));
const repoFile = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

describe("demo start guards", () => {
  it("needs DEMO_MODE=true and NODE_ENV=development, and no DATABASE_URL of its own", () => {
    expect(demoStartError({ DEMO_MODE: "true", NODE_ENV: "development" })).toBeNull();
    expect(demoStartError({ NODE_ENV: "development" })).toMatch(/DEMO_MODE=true/);
    expect(demoStartError({ DEMO_MODE: "true", NODE_ENV: "production" })).toMatch(/NODE_ENV=development/);
    expect(demoStartError({ DEMO_MODE: "true" })).toMatch(/NODE_ENV=development/);
    expect(demoStartError({ DEMO_MODE: "true", NODE_ENV: "development", DATABASE_URL: "postgres://db.x.supabase.co/postgres" })).toMatch(/unset DATABASE_URL/);
  });

  it("after loading, the database and auth must be the local demo ones and no provider key may be set", () => {
    const ports = { pglite: 5501, fakeSupabase: 5502 };
    const local = { DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5501/postgres", SUPABASE_URL: "http://127.0.0.1:5502" };
    expect(demoRuntimeError(local, {}, ports)).toBeNull();
    expect(demoRuntimeError({ ...local, DATABASE_URL: "postgres://u:p@db.abc.supabase.co:5432/postgres" }, {}, ports)).toMatch(/DATABASE_URL/);
    expect(demoRuntimeError({ ...local, DATABASE_URL: "postgres://u:p@127.0.0.1:5432/postgres" }, {}, ports)).toMatch(/DATABASE_URL/);
    expect(demoRuntimeError({ ...local, SUPABASE_URL: "https://abc.supabase.co" }, {}, ports)).toMatch(/SUPABASE_URL/);
    expect(demoRuntimeError(local, { RESEND_API_KEY: "re_live" }, ports)).toMatch(/RESEND_API_KEY/);
  });

  // The real entry point, as `npm run demo` starts it: it must refuse before starting anything.
  const runDemo = (env: Record<string, string>) => {
    const base = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !["DATABASE_URL", "NODE_ENV", "DEMO_MODE"].includes(k)),
    );
    return spawnSync(process.execPath, ["--import", "tsx", "demo/start.ts"], { cwd: backendDir, env: { ...base, ...env }, encoding: "utf8", timeout: 30_000 });
  };

  it("demo/start.ts exits at once without the opt-in, in production, or with a DATABASE_URL", () => {
    for (const env of <Record<string, string>[]>[
      { NODE_ENV: "development" },
      { DEMO_MODE: "true", NODE_ENV: "production" },
      { DEMO_MODE: "true", NODE_ENV: "development", DATABASE_URL: "postgres://u:p@db.abc.supabase.co:5432/postgres" },
    ]) {
      const result = runDemo(env);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/\[demo\] (Demo mode needs|DATABASE_URL is set)/);
    }
  }, 60_000);
});

describe("demo code stays out of production", () => {
  it("the production build (tsconfig.json) compiles nothing from demo/", () => {
    const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--listFilesOnly"], {
      cwd: backendDir,
      encoding: "utf8",
    });
    const files = result.stdout.split(/\r?\n/).map((f) => f.replaceAll("\\", "/"));
    expect(files.some((f) => f.includes("/Backend/src/index.ts"))).toBe(true);
    expect(files.filter((f) => f.includes("/Backend/demo/"))).toEqual([]);
  }, 60_000);

  it("compose.yaml and the Dockerfiles never enable demo mode", () => {
    for (const file of ["compose.yaml", "Backend/Dockerfile", "Frontend/Dockerfile"]) {
      expect(repoFile(file)).not.toMatch(/DEMO/i);
    }
    expect(repoFile("Backend/Dockerfile")).toMatch(/ENV NODE_ENV=production/);
  });
});
