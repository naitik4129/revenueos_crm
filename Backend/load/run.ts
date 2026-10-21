/**
 * LOAD TEST ONLY: `npm run load` (Backend/). Never built or shipped (outside src/, like demo/).
 *
 * 1. Refuses unless LOAD_DB_URL is the local crm_load database (guards.ts); it is read from the
 *    shell or Backend/.env and never printed.
 * 2. Rebuilds and seeds it (seed.ts): workspaces A 15k / B 5k / C 5k contacts.
 * 3. Starts the real API in this process, with the database and the (fake) Supabase Auth behind a
 *    proxy that adds LATENCY_MS to every round trip, like a remote Supabase.
 * 4. Times every list, page, dashboard and /brain/v1 route, the CSV import, 30 brain batches of
 *    500, the suppressions tie check and a mixed load; EXPLAINs anything over 300 ms.
 * 5. Writes load/RESULTS.md.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import http, { type Server } from "node:http";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { loadDbError } from "./guards.js";
import { startLatencyProxy } from "./latency.js";
import { USERS, WORKSPACES, seedLoadDb, sizes, tableCounts, uid, wsId } from "./seed.js";
import { installTracer, startTrace, stopTrace, type TracedStatement } from "./trace.js";

const LATENCY_MS = 15;
const RUNS = 20;
const TARGET_MS = 1000;
const BRAIN_TARGET_MS = 5000;
const EXPLAIN_OVER_MS = 300;
const RESULTS_FILE = fileURLToPath(new URL("./RESULTS.md", import.meta.url));

const log = (m: string) => console.log(`[load] ${m}`);

// --- 1. Guard ------------------------------------------------------------------------------
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
const fromFile = (() => {
  try {
    return dotenv.parse(readFileSync(envFile)).LOAD_DB_URL;
  } catch {
    return undefined;
  }
})();
const LOAD_DB_URL = process.env.LOAD_DB_URL ?? fromFile;
const guard = loadDbError(LOAD_DB_URL, process.env.NODE_ENV);
if (guard) {
  console.error(`[load] Refusing to run: ${guard}`);
  process.exit(1);
}
const dbUrl = new URL(LOAD_DB_URL!);

// --- HTTP client ---------------------------------------------------------------------------
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
let apiBase = "";

interface Reply {
  status: number;
  ms: number;
  json: unknown;
}
interface Who {
  token?: string;
  ws?: string;
  brainKey?: string;
}

function call(method: string, path: string, who: Who, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers: Record<string, string | number> = {};
  if (who.token) headers.authorization = `Bearer ${who.token}`;
  if (who.brainKey) headers.authorization = `Bearer ${who.brainKey}`;
  if (who.ws) headers["x-workspace-id"] = who.ws;
  if (payload) Object.assign(headers, { "content-type": "application/json", "content-length": payload.length });
  const started = performance.now();
  return new Promise((resolve) => {
    const req = http.request(`${apiBase}/api/v1${path}`, { method, headers, agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = text;
        }
        resolve({ status: res.statusCode ?? 0, ms: performance.now() - started, json });
      });
    });
    req.on("error", (err) => resolve({ status: 0, ms: performance.now() - started, json: String(err) }));
    if (payload) req.write(payload);
    req.end();
  });
}
const get = (path: string, who: Who) => call("GET", path, who);

// --- Measuring -----------------------------------------------------------------------------
interface Row {
  group: string;
  name: string;
  p50: number;
  p95: number;
  max: number;
  statements: number;
  errors: number;
  firstError?: string;
  slowest: TracedStatement[];
  target: number;
}
const rows: Row[] = [];
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;

/** Runs `fn` once to warm up, then RUNS times traced; one request (or one page) at a time. */
async function bench(group: string, name: string, fn: (i: number) => Promise<Reply[]>, runs = RUNS, target = TARGET_MS) {
  await fn(0);
  const times: number[] = [];
  const counts: number[] = [];
  let errors = 0;
  let firstError: string | undefined;
  let slowest: TracedStatement[] = [];
  let slowestMs = -1;
  for (let i = 0; i < runs; i++) {
    startTrace();
    const started = performance.now();
    const replies = await fn(i);
    const ms = performance.now() - started;
    const statements = stopTrace();
    times.push(ms);
    counts.push(statements.length);
    for (const r of replies) {
      if (r.status < 200 || r.status >= 300) {
        errors++;
        firstError ??= `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`;
      }
    }
    if (ms > slowestMs) {
      slowestMs = ms;
      slowest = statements;
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const row: Row = {
    group,
    name,
    p50: pct(sorted, 0.5),
    p95: pct(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
    statements: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length),
    errors,
    firstError,
    slowest,
    target,
  };
  rows.push(row);
  log(`${group} | ${name}: p50 ${row.p50.toFixed(0)} ms, p95 ${row.p95.toFixed(0)} ms, ${row.statements} SQL${errors ? `, ${errors} ERRORS: ${firstError}` : ""}`);
  return row;
}
const one = (path: string, who: Who) => async () => [await get(path, who)];

// --- Brain payloads ------------------------------------------------------------------------
const TRANSCRIPT = "AI: Hi, is now a good time?\nProspect: Sure, a couple of minutes.\n".repeat(25);
const companyBatch = (b: number) =>
  Array.from({ length: 500 }, (_, i) => ({
    source: "quickicp",
    externalId: `lt-co-${b}-${i}`,
    name: `Brain Co ${b}-${i}`,
    website: `https://lt-${b}-${i}.example`,
    industry: "SaaS",
    city: "Pune",
    country: "India",
    headcount: 50 + i,
  }));
/** Half new people (at the new brain companies), half updates of seeded people (quickicp p-n). */
const contactBatch = (b: number) =>
  Array.from({ length: 500 }, (_, i) =>
    i % 2 === 0
      ? {
          source: "quickicp",
          externalId: `lt-p-${b}-${i}`,
          firstName: "Brain",
          lastName: `Person ${b}-${i}`,
          jobTitle: "Founder",
          email: `brain.${b}.${i}@lt-${b % 8}-${i}.example`,
          phone: `+9180${String(b * 1000 + i).padStart(8, "0")}`,
          country: "India",
          companyRef: { source: "quickicp", externalId: `lt-co-${b % 8}-${i}` },
        }
      : { source: "quickicp", externalId: `p-${10_000 + b * 250 + i}`, linkedinUrl: `https://linkedin.com/in/p-${b}-${i}`, location: "Pune" },
  );
const callBatch = (b: number) =>
  Array.from({ length: 500 }, (_, i) => ({
    source: "quickhowl",
    externalId: `lt-call-${b}-${i}`,
    contact: { source: "quickicp", externalId: `p-${1 + ((b * 500 + i) % 15_000)}` },
    direction: "outbound",
    connected: i % 3 === 0,
    outcome: i % 3 === 0 ? "interested" : "no_answer",
    startedAt: new Date(Date.now() - i * 60_000).toISOString(),
    durationSeconds: i % 3 === 0 ? 120 : 0,
    summary: `Load test AI call ${b}-${i}`,
    transcript: i % 3 === 0 ? TRANSCRIPT : null,
  }));
const emailBatch = (b: number) =>
  Array.from({ length: 500 }, (_, i) => ({
    source: "email_tool",
    messageId: `lt-m-${b}-${i}`,
    contact: { source: "quickicp", externalId: `p-${1 + ((b * 500 + i * 7) % 15_000)}` },
    campaignRef: `lt-camp-${b}`,
    campaignName: `Load campaign ${b}`,
    step: 1,
    subject: "Quick question",
    event: "sent",
    occurredAt: new Date(Date.now() - i * 1000).toISOString(),
  }));
/** Contacts whose seeded deal is closed (A: 5001-8000), so handovers create or reopen deals. */
const handoverBatch = () =>
  Array.from({ length: 500 }, (_, i) => ({
    source: "quickicp",
    externalId: `lt-h-${i}`,
    contact: { source: "quickicp", externalId: `p-${5001 + i}` },
    ownerEmail: "sam@load.local",
    summary: `Qualified by the brain (${i})`,
    amount: 100_000,
  }));

interface BatchRow {
  route: string;
  batch: string;
  ms: number;
  statements: number | null;
  counts: string;
  errors: number;
}
const batchRows: BatchRow[] = [];
let slowestBatch: { route: string; statements: TracedStatement[] } | null = null;

async function brainBatch(route: string, label: string, items: unknown[], key: string, traced: boolean) {
  if (traced) startTrace();
  const r = await call("POST", `/brain/v1/${route}`, { brainKey: key }, { items });
  const statements = traced ? stopTrace() : null;
  const body = r.json as { counts?: Record<string, number> } | null;
  const counts = body?.counts ? Object.entries(body.counts).map(([k, v]) => `${k} ${v}`).join(", ") : `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`;
  const row = { route, batch: label, ms: r.ms, statements: statements?.length ?? null, counts, errors: r.status === 200 ? (body?.counts?.error ?? 0) : items.length };
  batchRows.push(row);
  if (statements && (!slowestBatch || statements.length > slowestBatch.statements.length)) slowestBatch = { route, statements };
  log(`brain ${route} ${label}: ${(r.ms / 1000).toFixed(1)} s, ${row.statements ?? "?"} SQL, ${counts}`);
  return row;
}

// --- EXPLAIN -------------------------------------------------------------------------------
const SKIP = /^\s*(begin|commit|rollback|savepoint|release)/i;
async function explainTop(db: pg.Client, statements: TracedStatement[], top = 3) {
  const seen = new Set<string>();
  const picked = [...statements]
    .filter((s) => !SKIP.test(s.text))
    .sort((a, b) => b.ms - a.ms)
    .filter((s) => (seen.has(s.text) ? false : (seen.add(s.text), true)))
    .slice(0, top);
  const out: string[] = [];
  for (const s of picked) {
    let plan: string;
    try {
      await db.query("begin");
      const r = await db.query<{ "QUERY PLAN": string }>(`explain (analyze, buffers) ${s.text}`, s.values as unknown[] | undefined);
      plan = r.rows.map((x) => x["QUERY PLAN"]).join("\n");
    } catch (err) {
      // An INSERT replayed after the run hits its own unique key: show the plan without running it.
      await db.query("rollback").catch(() => undefined);
      const why = err instanceof Error ? err.message : String(err);
      plan = await db
        .query<{ "QUERY PLAN": string }>(`explain ${s.text}`, s.values as unknown[] | undefined)
        .then((r) => `(not run: ${why})\n${r.rows.map((x) => x["QUERY PLAN"]).join("\n")}`)
        .catch((e: unknown) => `EXPLAIN failed: ${why}; ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await db.query("rollback").catch(() => undefined);
    }
    out.push(`Statement (${s.ms.toFixed(1)} ms in the request, incl. ${LATENCY_MS} ms latency):\n\n\`\`\`sql\n${s.text.trim().replace(/\n\s+/g, "\n  ")}\n\`\`\`\n\n\`\`\`\n${plan}\n\`\`\``);
  }
  return out.join("\n\n");
}

// --- Main ----------------------------------------------------------------------------------
async function main() {
  const startedAt = new Date();
  const direct = new pg.Client({ connectionString: LOAD_DB_URL });
  await direct.connect();
  const version = (await direct.query<{ v: string }>(`select current_setting('server_version') as v`)).rows[0]!.v;

  log("Rebuilding and seeding crm_load…");
  const seedStarted = performance.now();
  const seeded = await seedLoadDb(direct);
  log(`Seeded in ${((performance.now() - seedStarted) / 1000).toFixed(0)} s: ${JSON.stringify(seeded)}`);

  // Database and auth behind the latency proxy.
  const dbProxy = await startLatencyProxy({ host: dbUrl.hostname.replace(/^\[|\]$/g, ""), port: Number(dbUrl.port || 5432) }, LATENCY_MS);
  const { startFakeSupabase, DEMO_PASSWORD } = await import("../demo/fake-supabase.js");
  const fake = await startFakeSupabase(USERS.map((u) => ({ id: u.id, email: u.email })));
  const fakePort = Number(new URL(fake.url).port);
  const authProxy = await startLatencyProxy({ host: "127.0.0.1", port: fakePort }, LATENCY_MS);
  const proxiedDb = new URL(dbUrl.href);
  proxiedDb.hostname = "127.0.0.1";
  proxiedDb.port = String(dbProxy.port);

  // The app's environment, set before src/env.ts (and its dotenv) loads; provider keys blanked.
  const { BLANKED_PROVIDER_VARS } = await import("../demo/guards.js");
  Object.assign(process.env, {
    DATABASE_URL: proxiedDb.href,
    SUPABASE_URL: `http://127.0.0.1:${authProxy.port}`,
    SUPABASE_SERVICE_ROLE_KEY: "load",
    INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    NODE_ENV: "development",
    ...Object.fromEntries(BLANKED_PROVIDER_VARS.map((name) => [name, ""])),
  });
  installTracer();
  const { pool } = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  const { createBrainKey } = await import("../src/services/brain-keys.service.js");
  const server: Server = await new Promise((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  server.keepAliveTimeout = 120_000;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("API has no port.");
  apiBase = `http://127.0.0.1:${address.port}`;

  const token = async (email: string) => {
    const r = await fetch(`${fake.url}/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password: DEMO_PASSWORD }) });
    return ((await r.json()) as { access_token: string }).access_token;
  };
  const admin = USERS[0]!;
  const adminActor = { id: admin.id, fullName: admin.name, email: admin.email, isActive: true, role: "admin" as const };
  const A = wsId("A");
  const C = wsId("C");
  const sam: Who = { token: await token("sam@load.local"), ws: A };
  const adm: Who = { token: await token(admin.email), ws: A };
  const keyA = (await createBrainKey(adminActor, A, "Load test")).key;
  const keyC = (await createBrainKey(adminActor, C, "Load test")).key;
  const sA = sizes(15_000);

  // --- Lists, as a salesperson in workspace A ---
  log("Lists…");
  const list = (group: string, name: string, path: string, who: Who = sam) => bench(group, name, one(path, who));
  await list("App shell", "GET /me", "/me");
  await list("App shell", "GET /workspaces", "/workspaces");
  await list("App shell", "GET /profiles", "/profiles");
  await list("App shell", "GET /notifications", "/notifications");
  for (const [name, q] of [
    ["default", ""],
    ["sort=name", "?sort=name"],
    ["sort=-name", "?sort=-name"],
    ["sort=company", "?sort=company"],
    ["sort=-lastActivity", "?sort=-lastActivity"],
    ["sort=created", "?sort=created"],
    ["search=smith", "?search=smith"],
    ["search (no match)", "?search=zzqxv"],
    ["ownerId=none", "?ownerId=none"],
    ["hasOpenDeal=true", "?hasOpenDeal=true"],
    ["hasOpenDeal=false", "?hasOpenDeal=false"],
    ["lifecycleStage=engaged", "?lifecycleStage=engaged"],
    ["status=do_not_contact", "?status=do_not_contact"],
    ["last page (offset 14950)", "?offset=14950"],
    ["limit=500", "?limit=500"],
  ]) await list("Contacts list", name!, `/contacts${q}`);
  for (const [name, q] of [
    ["default (name)", ""],
    ["sort=contacts", "?sort=contacts"],
    ["sort=-openDeals", "?sort=-openDeals"],
    ["sort=created", "?sort=created"],
    ["search=Logistics", "?search=Logistics"],
    ["search (no match)", "?search=zzqxv"],
    ["ownerId=none", "?ownerId=none"],
    ["last page (offset 14950)", "?offset=14950"],
  ]) await list("Companies list", name!, `/companies${q}`);
  await list("Companies list", "GET /companies/industries", "/companies/industries");
  for (const [name, q] of [
    ["board (outcome=open, limit 500)", "?outcome=open&limit=500"],
    ["default", ""],
    ["sort=name", "?sort=name"],
    ["sort=-amount", "?sort=-amount"],
    ["sort=-lastActivity", "?sort=-lastActivity"],
    ["sort=-closed", "?sort=-closed"],
    ["search=smith", "?search=smith"],
    ["ownerId=none", "?ownerId=none"],
    ["missingNextAction=true", "?outcome=open&missingNextAction=true"],
    ["stage=negotiation", "?stage=negotiation"],
    ["last page (offset 7950)", "?offset=7950"],
  ]) await list("Deals list", name!, `/deals${q}`);
  for (const [name, q] of [
    ["open", "?status=open"],
    ["overdue", "?status=open&overdueOnly=true"],
    ["due today", "?status=open&dueTodayOnly=true"],
    ["upcoming", "?status=open&upcomingOnly=true"],
    ["open, offset 5000", "?status=open&offset=5000"],
  ]) await list("Tasks", name!, `/tasks${q}`);
  for (const when of ["upcoming", "past", "today"]) await list("Meetings", `when=${when}`, `/meetings?when=${when}`);
  await list("Proposals", "default", "/proposals");
  await list("Proposals", "status=sent", "/proposals?status=sent");
  await list("Proposals", "GET /proposals/summary", "/proposals/summary");
  await list("Automation", "GET /runs", "/runs");
  await list("Automation", "GET /runs?search=smith", "/runs?search=smith");
  await list("Automation", "GET /scheduled-actions", "/scheduled-actions");
  await list("Automation", "GET /scheduled-actions?search=smith", "/scheduled-actions?search=smith");
  await list("Automation", "GET /workflows", "/workflows");
  await list("Automation", "GET /templates", "/templates");
  await list("Dashboard", "GET /dashboard/summary", "/dashboard/summary");
  await list("Admin", "GET /admin/users", "/admin/users", adm);
  await list("Admin", "GET /workspaces/:id/members", `/workspaces/${A}/members`, adm);
  await list("Admin", "GET /workspaces/:id/brain-keys", `/workspaces/${A}/brain-keys`, adm);

  // --- Record pages: the calls each page makes (first the record, then the rest in parallel) ---
  log("Pages…");
  const contactN = (i: number) => 1 + ((i * 37) % sA.openDeals);
  await bench("Pages", "Contact page (11 calls)", async (i) => {
    const n = contactN(i);
    const id = uid("A", "ct", n);
    const first = await get(`/contacts/${id}`, sam);
    const companyId = uid("A", "co", ((n - 1) % sA.companiesWithContacts) + 1);
    const rest = await Promise.all([
      get(`/companies/${companyId}`, sam),
      get(`/deals/${uid("A", "dl", n)}/meetings`, sam),
      get(`/contacts/${id}/deals?limit=50`, sam),
      get(`/contacts/${id}/calls`, sam),
      get(`/contacts/${id}/email-activities`, sam),
      get(`/contacts/${id}/timeline?limit=100`, sam),
      get(`/contacts/${id}/notes`, sam),
      get(`/contacts/${id}/contactability`, sam),
      get(`/tasks?contactId=${id}&status=open&limit=20`, sam),
    ]);
    return [first, ...rest];
  });
  await bench("Pages", "Deal page (10 calls)", async (i) => {
    const n = contactN(i);
    const id = uid("A", "dl", n);
    const first = await get(`/deals/${id}`, sam);
    const rest = await Promise.all([
      get(`/deals/${id}/tasks?limit=200`, sam),
      get(`/deals/${id}/meetings`, sam),
      get(`/deals/${id}/proposals`, sam),
      get(`/deals/${id}/runs`, sam),
      get(`/scheduled-actions?dealId=${id}&limit=500`, sam),
      get(`/deals/${id}/timeline?limit=100`, sam),
      get(`/contacts/${uid("A", "ct", n)}`, sam),
      get(`/contacts/${uid("A", "ct", n)}/notes`, sam),
      get(`/companies/${uid("A", "co", ((n - 1) % sA.companiesWithContacts) + 1)}`, sam),
    ]);
    return [first, ...rest];
  });
  await bench("Pages", "Company page (4 calls + tasks of 10 open deals)", async (i) => {
    const id = uid("A", "co", 1 + ((i * 53) % sA.companiesWithContacts));
    const first = await get(`/companies/${id}`, sam);
    const [contacts, deals, timeline] = await Promise.all([get(`/companies/${id}/contacts?limit=200`, sam), get(`/companies/${id}/deals?limit=200`, sam), get(`/companies/${id}/timeline?limit=100`, sam)]);
    const openDeals = ((deals.json as { data?: { id: string; outcome: string }[] }).data ?? []).filter((d) => d.outcome === "open").slice(0, 10);
    const tasks = await Promise.all(openDeals.map((d) => get(`/deals/${d.id}/tasks?limit=200`, sam)));
    return [first, contacts, deals, timeline, ...tasks];
  });

  // --- Brain reads ---
  log("Brain reads…");
  await bench("Brain", "GET /suppressions (full list)", one("/brain/v1/suppressions", { brainKey: keyA }));
  await bench("Brain", "GET /suppressions?limit=5000", one("/brain/v1/suppressions?limit=5000", { brainKey: keyA }));
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await bench("Brain", "GET /suppressions?since=30 days ago", one(`/brain/v1/suppressions?since=${encodeURIComponent(since)}`, { brainKey: keyA }));

  // --- CSV import, 2,000 rows, once ---
  log("CSV import (2,000 rows)…");
  const csvRows = Array.from({ length: 2000 }, (_, i) => ({
    rowNumber: i + 2,
    firstName: "Csv",
    lastName: `Person ${i}`,
    email: `csv.person.${i}@csv-${i % 400}.example`,
    phone: `+9170${String(i).padStart(8, "0")}`,
    company: `CSV Co ${i % 400}`,
    website: `csv-${i % 400}.example`,
    industry: "Retail",
    source: "linkedin",
  }));
  startTrace();
  const csv = await call("POST", "/contacts/import", sam, { rows: csvRows });
  const csvStatements = stopTrace();
  const csvData = (csv.json as { data?: { created: unknown[]; duplicates: unknown[]; failed: unknown[] } }).data;
  const csvSummary = csvData ? `created ${csvData.created.length}, duplicates ${csvData.duplicates.length}, failed ${csvData.failed.length}` : `HTTP ${csv.status} ${JSON.stringify(csv.json).slice(0, 200)}`;
  log(`CSV: ${(csv.ms / 1000).toFixed(1)} s, ${csvStatements.length} SQL, ${csvSummary}`);

  // --- Brain batches: 27 one after another, then 3 at once during the mixed load, then handovers ---
  log("Brain batches…");
  for (let b = 0; b < 8; b++) await brainBatch("companies", `${b + 1}/8`, companyBatch(b), keyA, true);
  for (let b = 0; b < 5; b++) await brainBatch("contacts", `${b + 1}/8`, contactBatch(b), keyA, true);
  for (let b = 0; b < 7; b++) await brainBatch("calls", `${b + 1}/7`, callBatch(b), keyA, true);
  for (let b = 0; b < 7; b++) await brainBatch("email-events", `${b + 1}/7`, emailBatch(b), keyA, true);

  // --- Mixed load: 10 users browsing while 3 contact batches run at once ---
  log("Mixed load: 10 users + 3 concurrent brain batches…");
  // The fake auth's sessions last an hour and the run is longer: sign in again first.
  sam.token = await token("sam@load.local");
  const userTimes: number[] = [];
  let userErrors = 0;
  let firstUserError: string | undefined;
  let browsing = true;
  const userRoutes = (i: number) => {
    const n = contactN(i);
    return [`/contacts`, `/deals?outcome=open&limit=500`, `/contacts/${uid("A", "ct", n)}`, `/contacts/${uid("A", "ct", n)}/timeline?limit=100`, `/dashboard/summary`, `/tasks?status=open`];
  };
  const users = Array.from({ length: 10 }, async (_, u) => {
    for (let i = 0; browsing; i++) {
      for (const path of userRoutes(u * 100 + i)) {
        if (!browsing) break;
        const r = await get(path, sam);
        userTimes.push(r.ms);
        if (r.status !== 200) {
          userErrors++;
          firstUserError ??= `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`;
        }
      }
    }
  });
  const concurrent = await Promise.all([5, 6, 7].map((b) => brainBatch("contacts", `${b + 1}/8 (3 at once, mixed load)`, contactBatch(b), keyA, false)));
  browsing = false;
  await Promise.all(users);
  const userSorted = [...userTimes].sort((a, b) => a - b);
  const mixed = { requests: userSorted.length, p50: pct(userSorted, 0.5), p95: pct(userSorted, 0.95), max: userSorted.at(-1) ?? 0, errors: userErrors, firstError: firstUserError, batchMs: concurrent.map((r) => r.ms) };
  log(`Mixed: ${mixed.requests} user requests, p50 ${mixed.p50.toFixed(0)} ms, p95 ${mixed.p95.toFixed(0)} ms, max ${mixed.max.toFixed(0)} ms, ${mixed.errors} errors${firstUserError ? ` (first: ${firstUserError})` : ""}`);
  sam.token = await token("sam@load.local");

  await brainBatch("handovers", "1/1", handoverBatch(), keyA, true);

  // --- Suppressions tie check (workspace C): 1,200 unsubscribes in one statement share one timestamp ---
  log("Suppressions tie check…");
  const t0 = (await direct.query<{ t: Date }>(`select now() as t`)).rows[0]!.t.toISOString();
  await new Promise((r) => setTimeout(r, 50));
  const bulk = await direct.query(
    `update crm.contact_channels ch set status = 'unsubscribed', updated_at = now()
       from crm.contacts c
      where c.id = ch.contact_id and c.workspace_id = $1 and c.status = 'active' and ch.channel = 'email' and ch.status = 'valid'
        and ch.contact_id in (select id from crm.contacts where workspace_id = $1 and status = 'active' order by id limit 1200)`,
    [C],
  );
  const expected = bulk.rowCount ?? 0;
  const got = new Set<string>();
  let cursor = t0;
  let pages = 0;
  for (; pages < 20; pages++) {
    const r = await get(`/brain/v1/suppressions?since=${encodeURIComponent(cursor)}&limit=500`, { brainKey: keyC });
    const body = r.json as { data: { contactId: string }[]; nextSince: string | null };
    for (const s of body.data) got.add(s.contactId);
    if (body.data.length < 500 || !body.nextSince) {
      pages++;
      break;
    }
    cursor = body.nextSince;
  }
  const tie = { expected, got: got.size, pages, pass: got.size === expected, stuck: pages >= 20 };
  log(`Tie check: expected ${expected}, got ${got.size} over ${pages} page(s): ${tie.pass ? "PASS" : "FAIL"}`);

  // --- EXPLAIN for anything over 300 ms (direct connection, no added latency) ---
  log("EXPLAIN…");
  const explains: string[] = [];
  for (const r of rows.filter((x) => x.p95 > EXPLAIN_OVER_MS)) explains.push(`### ${r.group}: ${r.name} (p95 ${r.p95.toFixed(0)} ms, ${r.statements} SQL)\n\n${await explainTop(direct, r.slowest)}`);
  if (csv.ms > EXPLAIN_OVER_MS) explains.push(`### CSV import, 2,000 rows (${(csv.ms / 1000).toFixed(1)} s, ${csvStatements.length} SQL)\n\n${await explainTop(direct, csvStatements)}`);
  const sb = slowestBatch as { route: string; statements: TracedStatement[] } | null;
  if (sb) explains.push(`### Brain batch with the most SQL: ${sb.route} (${sb.statements.length} SQL)\n\n${await explainTop(direct, sb.statements)}`);

  const after = await tableCounts(direct);
  writeFileSync(RESULTS_FILE, report({ startedAt, version, seeded, after, csv: { ms: csv.ms, statements: csvStatements.length, summary: csvSummary }, mixed, tie, explains }));
  log(`Wrote ${RESULTS_FILE}`);

  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  agent.destroy();
  await pool.end();
  await Promise.all([dbProxy.stop(), authProxy.stop(), fake.stop()]);
  await direct.end();
}

// --- Report --------------------------------------------------------------------------------
const f = (ms: number) => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)}`);
const fu = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const ok = (ms: number, target: number) => (ms <= target ? "✅" : "❌");

function report(r: {
  startedAt: Date;
  version: string;
  seeded: Record<string, number>;
  after: Record<string, number>;
  csv: { ms: number; statements: number; summary: string };
  mixed: { requests: number; p50: number; p95: number; max: number; errors: number; firstError?: string; batchMs: number[] };
  tie: { expected: number; got: number; pages: number; pass: boolean; stuck: boolean };
  explains: string[];
}) {
  const lines: string[] = [];
  const failing = rows.filter((x) => x.p95 > x.target || x.errors);
  const slowBatches = batchRows.filter((b) => b.ms > BRAIN_TARGET_MS);
  lines.push(
    `# Load test results`,
    ``,
    `Generated by \`npm run load\` (Backend/load/run.ts). Each run overwrites this file; commit it to keep the history.`,
    ``,
    `## Run ${r.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC: baseline (before migration 014)`,
    ``,
    `- Postgres ${r.version} (local, native), Node ${process.version}, Windows. App pool \`max: 10\` as in \`src/db.ts\`.`,
    `- **+${LATENCY_MS} ms per round trip** to the database and to Supabase Auth (TCP proxy, \`load/latency.ts\`).`,
    `- Seed: ${WORKSPACES.map((w) => `${w.key} ${w.contacts / 1000}k`).join(" / ")} contacts. All workspaces: ${Object.entries(r.seeded).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(", ")}.`,
    `- Requests as a salesperson member of workspace A (admin for Admin rows); ${RUNS} timed runs after 1 warm-up, one at a time. Times in ms. "SQL" = statements per request (each one a round trip).`,
    `- Targets: p95 ≤ ${TARGET_MS} ms per request or page; brain batch of 500 ≤ ${BRAIN_TARGET_MS / 1000} s.`,
    ``,
    `**Summary:** ${failing.length} of ${rows.length} request rows miss the target or had errors; ${slowBatches.length} of ${batchRows.length} brain batches over ${BRAIN_TARGET_MS / 1000} s; CSV 2,000 rows ${fu(r.csv.ms)}; suppressions tie check **${r.tie.pass ? "PASS" : "FAIL"}**.`,
    ``,
    `### Requests`,
    ``,
    `| Group | Route | p50 | p95 | max | SQL | Errors | |`,
    `|---|---|---:|---:|---:|---:|---:|---|`,
    ...rows.map((x) => `| ${x.group} | ${x.name} | ${f(x.p50)} | ${f(x.p95)} | ${f(x.max)} | ${x.statements} | ${x.errors ? `${x.errors}: ${x.firstError?.replace(/\|/g, "/")}` : 0} | ${x.errors ? "❌" : ok(x.p95, x.target)} |`),
    ``,
    `### Brain batches (500 items each, workspace A)`,
    ``,
    `| Route | Batch | Time | SQL | Result | |`,
    `|---|---|---:|---:|---|---|`,
    ...batchRows.map((b) => `| ${b.route} | ${b.batch} | ${(b.ms / 1000).toFixed(1)} s | ${b.statements ?? "not traced"} | ${b.counts} | ${b.errors ? "❌" : ok(b.ms, BRAIN_TARGET_MS)} |`),
    ``,
    `### CSV import (2,000 rows, one request, workspace A)`,
    ``,
    `${fu(r.csv.ms)}, ${r.csv.statements} SQL, ${r.csv.summary}. ${ok(r.csv.ms, TARGET_MS)}`,
    ``,
    `### Mixed load`,
    ``,
    `10 users browsing workspace A (contacts list, deals board, contact, timeline, dashboard, tasks) while 3 contact batches of 500 run at once.`,
    ``,
    `| User requests | p50 | p95 | max | Errors | Brain batches (3 at once) |`,
    `|---:|---:|---:|---:|---:|---|`,
    `| ${r.mixed.requests} | ${f(r.mixed.p50)} | ${f(r.mixed.p95)} | ${f(r.mixed.max)} | ${r.mixed.errors ? `${r.mixed.errors} ❌ (first: ${r.mixed.firstError?.replace(/\|/g, "/")})` : 0} | ${r.mixed.batchMs.map((ms) => `${(ms / 1000).toFixed(1)} s`).join(", ")} |`,
    ``,
    `### Suppressions tie check (workspace C)`,
    ``,
    `One statement unsubscribed ${r.tie.expected} contacts (same \`updated_at\`); paging \`GET /brain/v1/suppressions?since=…&limit=500\` with \`nextSince\` returned **${r.tie.got}** of them in ${r.tie.pages} page(s): **${r.tie.pass ? "PASS" : "FAIL"}**.${
      r.tie.stuck
        ? ` The cursor never advanced: the harness stopped after ${r.tie.pages} pages that kept returning the same rows. \`nextSince\` is an ISO string with milliseconds while \`updated_at\` has microseconds, so \`changed_at > since\` matches the same tied rows again; a brain following \`nextSince\` would loop forever.`
        : ""
    }`,
    ``,
    `### Row counts after the run`,
    ``,
    Object.entries(r.after).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(", "),
    ``,
    `### EXPLAIN (ANALYZE, BUFFERS) for anything over ${EXPLAIN_OVER_MS} ms`,
    ``,
    `Run on a direct connection (no added latency) inside BEGIN … ROLLBACK, for the slowest statements of the slowest run.`,
    ``,
    r.explains.length ? r.explains.join("\n\n") : "Nothing over the threshold.",
    ``,
  );
  return lines.join("\n");
}

main().catch(async (err) => {
  console.error("[load] Failed:", err);
  process.exit(1);
});
