/**
 * DEMO MODE ONLY: `npm run demo`. One Node process runs everything, so stopping it (Ctrl+C, or
 * closing the window) frees every port, on Windows too:
 *   PGlite (migrations 000-012 + seed) -> fake Supabase Auth/Storage -> API on 127.0.0.1:8787
 *   -> automation worker in dry run -> Vite dev server (the frontend) on 127.0.0.1:8080.
 *
 * Lives outside src/, so it is never compiled into dist/ or a Docker image.
 */
import { randomBytes } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import type { Server } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BLANKED_PROVIDER_VARS, demoRuntimeError, demoStartError } from "./guards.js";
import { DEMO_PASSWORD, startFakeSupabase } from "./fake-supabase.js";
import { DEMO_USERS } from "./users.js";

const API_PORT = 8787;
const FRONTEND_PORT = 8080;
const WORKER_INTERVAL_MS = 10_000;

// 1. Refuse before anything else is loaded.
const startError = demoStartError(process.env);
if (startError) {
  console.error(`[demo] ${startError}`);
  process.exit(1);
}

const cleanups: (() => Promise<unknown> | unknown)[] = [];
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  console.log("\n[demo] Stopping…");
  // Last started, first stopped. A stuck step must not keep the ports open.
  const timer = setTimeout(() => process.exit(code), 5_000);
  for (const cleanup of cleanups.reverse()) await Promise.resolve(cleanup()).catch(() => undefined);
  clearTimeout(timer);
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.on(signal, () => void stop(0));

function fail(message: string): never {
  console.error(`[demo] ${message}`);
  void stop(1);
  throw new Error(message);
}

const portIsFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createNetServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });

async function main() {
  for (const port of [API_PORT, FRONTEND_PORT]) {
    if (!(await portIsFree(port))) fail(`Port ${port} is already in use. Stop whatever is using it and try again.`);
  }

  // 2. The local database: same Supabase stand-ins and migrations as the integration tests.
  const { startTestDb } = await import("../tests/integration/testDb.js");
  const db = await startTestDb();
  cleanups.push(() => db.stop());
  const fake = await startFakeSupabase(DEMO_USERS);
  cleanups.push(() => fake.stop());

  // 3. The demo environment, set before the backend's env.ts (and its dotenv) loads.
  Object.assign(process.env, {
    DATABASE_URL: db.url,
    SUPABASE_URL: fake.url,
    SUPABASE_SERVICE_ROLE_KEY: "demo",
    INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    PORT: String(API_PORT),
    CORS_ORIGINS: `http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}`,
    ...Object.fromEntries(BLANKED_PROVIDER_VARS.map((name) => [name, ""])),
  });
  const { env } = await import("../src/env.js");
  const runtimeError = demoRuntimeError(env, process.env, {
    pglite: Number(new URL(db.url).port),
    fakeSupabase: Number(new URL(fake.url).port),
  });
  if (runtimeError) fail(runtimeError);

  // 4. Seed, then the API.
  const { pool } = await import("../src/db.js");
  cleanups.push(() => pool.end());
  const { seedDemo } = await import("./seed.js");
  const counts = await seedDemo();
  const { createApp } = await import("../src/app.js");
  const api: Server = await new Promise((resolve) => {
    const server = createApp().listen(API_PORT, "127.0.0.1", () => resolve(server));
  });
  cleanups.push(() => new Promise((resolve) => {
    api.closeAllConnections();
    api.close(resolve);
  }));

  // 5. The worker, dry run only: sends become "(dry run)" timeline entries, no provider is called.
  // worker.ts is not used, so no WhatsApp session is ever started.
  const { runAutomationTick } = await import("../src/services/automation-runner.js");
  let ticking = false;
  const worker = setInterval(() => {
    if (ticking) return;
    ticking = true;
    runAutomationTick({ batchSize: 20, dryRun: true, log: (m) => console.log(m) })
      .catch((err) => console.error("[demo worker]", err))
      .finally(() => (ticking = false));
  }, WORKER_INTERVAL_MS);
  cleanups.push(() => clearInterval(worker));

  // 6. The frontend: Vite from Frontend/node_modules, in this same process.
  const frontendRoot = fileURLToPath(new URL("../../Frontend/", import.meta.url));
  Object.assign(process.env, {
    VITE_SUPABASE_URL: fake.url,
    VITE_SUPABASE_ANON_KEY: "demo",
    VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
    VITE_DEMO_MODE: "true",
  });
  const vite = (await import(pathToFileURL(`${frontendRoot}node_modules/vite/dist/node/index.js`).href)) as {
    createServer: (config: object) => Promise<{ listen: () => Promise<unknown>; close: () => Promise<void> }>;
  };
  const frontend = await vite.createServer({
    root: frontendRoot,
    configFile: `${frontendRoot}vite.config.ts`,
    mode: "development",
    server: { host: "127.0.0.1", port: FRONTEND_PORT, strictPort: true },
  });
  await frontend.listen();
  cleanups.push(() => frontend.close());

  console.log(`
[demo] Northbeam CRM demo is running (seeded ${counts.companies} companies, ${counts.contacts} contacts, ${counts.deals} deals).
[demo] Open http://127.0.0.1:${FRONTEND_PORT} and pick a user (password "${DEMO_PASSWORD}"):
${DEMO_USERS.map((u) => `         ${u.email.padEnd(18)} ${u.name} (${u.role})`).join("\n")}
[demo] API http://127.0.0.1:${API_PORT}. Data is in memory and reset on every start. Ctrl+C to stop.
`);
}

main().catch((err) => {
  if (!stopping) console.error("[demo] Failed to start:", err);
  void stop(1);
});
