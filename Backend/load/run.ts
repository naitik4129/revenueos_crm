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
 *
 * Quick mode, for a re-measure: `npm run load -- --only <area>` seeds the same data, runs only
 * that area (brain areas: the first QUICK_BATCHES batches of one route) and appends a section to
 * RESULTS.md instead of rewriting it.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
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
const CSV_TARGET_MS = 10_000;
const MIXED_MS = 60_000;
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

const AREAS = ["suppressions", "brain-companies", "brain-contacts", "brain-calls", "brain-email", "brain-handovers", "csv", "mixed", "reads"];
/** `--only reads`: the slowest reads of the baseline (group: name, as in the report). */
const SLOW_READS = new Set([
  "Pages: Company page (4 calls + tasks of 10 open deals)",
  "Pages: Contact page (11 calls)",
  "Pages: Deal page (10 calls)",
  "Companies list: last page (offset 14950)",
  "Contacts list: last page (offset 14950)",
  "Deals list: last page (offset 7950)",
  "Dashboard: GET /dashboard/summary",
]);
const QUICK_BATCHES = 3;
const onlyAt = process.argv.indexOf("--only");
const ONLY = onlyAt >= 0 ? (process.argv[onlyAt + 1] ?? "") : undefined;
if (ONLY !== undefined && !AREAS.includes(ONLY)) {
  console.error(`[load] --only needs one of: ${AREAS.join(", ")}.`);
  process.exit(1);
}
const FULL = ONLY === undefined;
const want = (area: string) => FULL || ONLY === area;

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
  if (ONLY === "reads" && !SLOW_READS.has(`${group}: ${name}`)) return;
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
/** 500 handovers, sent as 10 requests of 50 (the route's cap). */
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
  /** Times the API fell back to one transaction per item while this batch ran (its console warning). */
  fallbacks: number;
}
const batchRows: BatchRow[] = [];
let slowestBatch: { route: string; statements: TracedStatement[] } | null = null;

let fallbacks = 0;
const FALLBACK_WARNING = "[brain] Batch fell back";
function countFallbacks() {
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).startsWith(FALLBACK_WARNING)) fallbacks++;
    warn(...args);
  };
}

async function brainBatch(route: string, label: string, items: unknown[], key: string, traced: boolean, record = true) {
  if (traced) startTrace();
  const before = fallbacks;
  const r = await call("POST", `/brain/v1/${route}`, { brainKey: key }, { items });
  const statements = traced ? stopTrace() : null;
  const body = r.json as { counts?: Record<string, number> } | null;
  const counts = body?.counts ? Object.entries(body.counts).map(([k, v]) => `${k} ${v}`).join(", ") : `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`;
  const row = { route, batch: label, ms: r.ms, statements: statements?.length ?? null, counts, errors: r.status === 200 ? (body?.counts?.error ?? 0) : items.length, fallbacks: fallbacks - before };
  if (record) batchRows.push(row);
  if (statements && (!slowestBatch || statements.length > slowestBatch.statements.length)) slowestBatch = { route, statements };
  log(`brain ${route} ${label}: ${(r.ms / 1000).toFixed(1)} s, ${row.statements ?? "?"} SQL, ${counts}${row.fallbacks ? `, ${row.fallbacks} FALLBACK(S)` : ""}`);
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
  countFallbacks();
  const { pool } = await import("../src/db.js");
  const live = (await pool.query<{ statement_timeout: string }>(`show statement_timeout`)).rows[0]!.statement_timeout;
  if (live !== "15s") throw new Error(`App pool statement_timeout is ${live}, expected 15s.`);
  log(`App pool: max ${pool.options.max}, statement_timeout ${live}.`);
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
  const list = (group: string, name: string, path: string, who: Who = sam) => bench(group, name, one(path, who));
  const contactN = (i: number) => 1 + ((i * 37) % sA.openDeals);
  if (want("reads")) {
    log("Lists…");
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
  }

  // --- Brain reads ---
  if (want("suppressions")) {
    log("Brain reads…");
    await bench("Brain", "GET /suppressions (full list, first page)", one("/brain/v1/suppressions", { brainKey: keyA }));
    await bench("Brain", "GET /suppressions?limit=5000", one("/brain/v1/suppressions?limit=5000", { brainKey: keyA }));
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await bench("Brain", "GET /suppressions?since=30 days ago", one(`/brain/v1/suppressions?since=${encodeURIComponent(since)}`, { brainKey: keyA }));
  }

  // --- CSV import, 2,000 rows, once ---
  let csv: { ms: number; statements: TracedStatement[]; summary: string } | null = null;
  if (want("csv")) {
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
    // Like the client: chunks of 500, one request each, one after another.
    startTrace();
    const totals = { created: 0, duplicates: 0, failed: 0 };
    const chunkMs: number[] = [];
    let httpError = "";
    for (let at = 0; at < csvRows.length && !httpError; at += 500) {
      const r = await call("POST", "/contacts/import", sam, { rows: csvRows.slice(at, at + 500) });
      chunkMs.push(r.ms);
      const data = (r.json as { data?: { created: unknown[]; duplicates: unknown[]; failed: unknown[] } }).data;
      if (!data) httpError = `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`;
      else for (const k of ["created", "duplicates", "failed"] as const) totals[k] += data[k].length;
    }
    const statements = stopTrace();
    const ms = chunkMs.reduce((a, b) => a + b, 0);
    const summary = `${chunkMs.length} chunks of 500 (${chunkMs.map((c) => `${(c / 1000).toFixed(1)} s`).join(", ")}): ${httpError || `created ${totals.created}, duplicates ${totals.duplicates}, failed ${totals.failed}`}`;
    csv = { ms, statements, summary };
    log(`CSV: ${(ms / 1000).toFixed(1)} s, ${statements.length} SQL, ${summary}`);
  }

  // --- Brain batches: 27 one after another, then 3 at once during the mixed load, then handovers.
  // Quick mode (--only brain-…) runs the first QUICK_BATCHES of one route.
  const count = (full: number) => (FULL ? full : Math.min(full, QUICK_BATCHES));
  const batches = async (area: string, route: string, total: number, sequential: number, make: (b: number) => unknown[]) => {
    if (!want(area)) return;
    const n = count(sequential);
    for (let b = 0; b < n; b++) await brainBatch(route, `${b + 1}/${FULL ? total : n}`, make(b), keyA, true);
  };
  if (FULL || ONLY?.startsWith("brain-")) log("Brain batches…");
  await batches("brain-companies", "companies", 8, 8, companyBatch);
  await batches("brain-contacts", "contacts", 8, 5, contactBatch);
  await batches("brain-calls", "calls", 7, 7, callBatch);
  await batches("brain-email", "email-events", 7, 7, emailBatch);

  // --- Mixed load: 10 users browsing while 3 contact batches run at once ---
  let mixed: MixedResult | null = null;
  if (want("mixed")) {
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
    // MIXED_MS of browsing; meanwhile contact batches run 3 at a time, again and again (batches 5-17 in turn:
    // the first round of each creates and fills, later ones re-send, like the brain re-sending a list).
    const concurrent: BatchRow[] = [];
    const until = performance.now() + MIXED_MS;
    for (let round = 0; performance.now() < until; round++) {
      const bs = [0, 1, 2].map((k) => 5 + ((round * 3 + k) % 13));
      concurrent.push(...(await Promise.all(bs.map((b) => brainBatch("contacts", `mixed round ${round + 1}`, contactBatch(b), keyA, false, false)))));
    }
    browsing = false;
    await Promise.all(users);
    const userSorted = [...userTimes].sort((a, b) => a - b);
    mixed = { requests: userSorted.length, p50: pct(userSorted, 0.5), p95: pct(userSorted, 0.95), max: userSorted.at(-1) ?? 0, errors: userErrors, firstError: firstUserError, batchMs: concurrent.map((r) => r.ms) };
    log(`Mixed (${MIXED_MS / 1000} s): ${concurrent.length} brain batches, ${mixed.requests} user requests, p50 ${mixed.p50.toFixed(0)} ms, p95 ${mixed.p95.toFixed(0)} ms, max ${mixed.max.toFixed(0)} ms, ${mixed.errors} errors${firstUserError ? ` (first: ${firstUserError})` : ""}`);
    sam.token = await token("sam@load.local");
  }

  if (want("brain-handovers")) {
    const all = handoverBatch();
    for (let b = 0; b < all.length / 50; b++) await brainBatch("handovers", `${b + 1}/10 (50 items)`, all.slice(b * 50, (b + 1) * 50), keyA, true);
  }

  // --- Suppressions checks (workspace C): follow `next` until hasMore is false ---
  const checks: FeedCheck[] = [];
  if (want("suppressions")) {
    log("Suppressions paging checks…");
    const blockedInC = async () =>
      Number(
        (
          await direct.query<{ n: string }>(
            `select count(*) as n from crm.contacts c
              where c.workspace_id = $1 and c.status <> 'merged'
                and (c.status = 'do_not_contact' or exists (
                  select 1 from crm.contact_channels ch where ch.contact_id = c.id
                     and ((ch.channel = 'email' and ch.status in ('unsubscribed', 'permanent_bounce'))
                       or (ch.channel = 'phone' and ch.status = 'do_not_contact')
                       or (ch.channel = 'whatsapp' and ch.status in ('do_not_contact', 'opted_out')))))`,
            [C],
          )
        ).rows[0]!.n,
      );
    // 1. A bulk unsubscribe in one statement: 1,000+ rows share one updated_at.
    const t0 = (await direct.query<{ t: Date }>(`select now() as t`)).rows[0]!.t.toISOString();
    await new Promise((r) => setTimeout(r, 50));
    const bulk = await direct.query(
      `update crm.contact_channels ch set status = 'unsubscribed', updated_at = now()
         from crm.contacts c
        where c.id = ch.contact_id and c.workspace_id = $1 and c.status = 'active' and ch.channel = 'email' and ch.status = 'valid'
          and ch.contact_id in (select id from crm.contacts where workspace_id = $1 and status = 'active' order by id limit 1200)`,
      [C],
    );
    checks.push(await followFeed(`Change feed after a bulk unsubscribe (since=…, limit=500)`, `/brain/v1/suppressions?since=${encodeURIComponent(t0)}&limit=500`, keyC, bulk.rowCount ?? 0));
    // 2. The full list, paged, then one more page from its last `next` (nothing changed since: empty).
    const full = await followFeed(`Full list (no cursor, limit=500)`, `/brain/v1/suppressions?limit=500`, keyC, await blockedInC());
    checks.push(full);
    const after = (await get(`/brain/v1/suppressions?cursor=${full.lastNext}&limit=500`, { brainKey: keyC })).json as { data: unknown[] };
    checks.push({ name: "Change feed from the full list's last `next` (no changes since)", expected: 0, rows: after.data.length, unique: after.data.length, pages: 1, stuck: false, pass: after.data.length === 0, lastNext: "" });
    for (const c of checks) log(`${c.name}: expected ${c.expected}, ${c.rows} rows (${c.unique} unique) over ${c.pages} page(s)${c.stuck ? ", cursor STUCK" : ""}: ${c.pass ? "PASS" : "FAIL"}`);
  }

  // --- EXPLAIN for anything over 300 ms (direct connection, no added latency) ---
  log("EXPLAIN…");
  const explains: string[] = [];
  for (const r of rows.filter((x) => x.p95 > EXPLAIN_OVER_MS)) explains.push(`### ${r.group}: ${r.name} (p95 ${r.p95.toFixed(0)} ms, ${r.statements} SQL)\n\n${await explainTop(direct, r.slowest)}`);
  if (csv && csv.ms > EXPLAIN_OVER_MS) explains.push(`### CSV import, 2,000 rows (${(csv.ms / 1000).toFixed(1)} s, ${csv.statements.length} SQL)\n\n${await explainTop(direct, csv.statements)}`);
  const sb = slowestBatch as { route: string; statements: TracedStatement[] } | null;
  if (sb) explains.push(`### Brain batch with the most SQL: ${sb.route} (${sb.statements.length} SQL)\n\n${await explainTop(direct, sb.statements)}`);

  const after = await tableCounts(direct);
  const result = { startedAt, version, seeded, after, csv: csv && { ms: csv.ms, statements: csv.statements.length, summary: csv.summary }, mixed, checks, explains };
  if (FULL) writeFileSync(RESULTS_FILE, report(result));
  else appendFileSync(RESULTS_FILE, `\n${section(result)}`);
  log(`${FULL ? "Wrote" : "Appended to"} ${RESULTS_FILE}`);

  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  agent.destroy();
  await pool.end();
  await Promise.all([dbProxy.stop(), authProxy.stop(), fake.stop()]);
  await direct.end();
}

// --- Suppressions feed check -------------------------------------------------------------------
interface FeedCheck {
  name: string;
  expected: number;
  rows: number;
  unique: number;
  pages: number;
  stuck: boolean;
  pass: boolean;
  lastNext: string;
}

/** Follows `next` until hasMore is false; fails on a repeated cursor, a repeated row or a wrong count. */
async function followFeed(name: string, first: string, key: string, expected: number): Promise<FeedCheck> {
  const ids: string[] = [];
  const cursors = new Set<string>();
  let path = first;
  let pages = 0;
  let stuck = false;
  let lastNext = "";
  while (pages < 50) {
    const r = await get(path, { brainKey: key });
    pages++;
    const body = r.json as { data?: { contactId: string }[]; next?: string; hasMore?: boolean };
    if (r.status !== 200 || !body.data || !body.next) {
      stuck = true;
      break;
    }
    ids.push(...body.data.map((s) => s.contactId));
    if (cursors.has(body.next)) {
      stuck = true;
      break;
    }
    cursors.add(body.next);
    lastNext = body.next;
    if (!body.hasMore) break;
    path = `/brain/v1/suppressions?cursor=${body.next}&limit=500`;
  }
  if (pages >= 50) stuck = true;
  const unique = new Set(ids).size;
  return { name, expected, rows: ids.length, unique, pages, stuck, pass: !stuck && unique === expected && ids.length === expected, lastNext };
}

// --- Report --------------------------------------------------------------------------------
interface MixedResult {
  requests: number;
  p50: number;
  p95: number;
  max: number;
  errors: number;
  firstError?: string;
  batchMs: number[];
}
interface RunResult {
  startedAt: Date;
  version: string;
  seeded: Record<string, number>;
  after: Record<string, number>;
  csv: { ms: number; statements: number; summary: string } | null;
  mixed: MixedResult | null;
  checks: FeedCheck[];
  explains: string[];
}

const f = (ms: number) => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)}`);
const batchSummary = (ms: number[]) => {
  const sorted = [...ms].sort((a, b) => a - b);
  return `${ms.length} batches, p50 ${fu(pct(sorted, 0.5))}, max ${fu(sorted.at(-1) ?? 0)}`;
};
const fu = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const ok = (ms: number, target: number) => (ms <= target ? "✅" : "❌");
const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

/** The whole file, for a full run. */
function report(r: RunResult) {
  return [
    `# Load test results`,
    ``,
    `Generated by \`npm run load\` (Backend/load/run.ts). A full run overwrites this file; \`npm run load -- --only <area>\` appends a quick-run section. Commit it to keep the history.`,
    ``,
    section(r),
  ].join("\n");
}

/** One run: the full baseline, or a quick `--only` re-measure. */
function section(r: RunResult) {
  const failing = rows.filter((x) => x.p95 > x.target || x.errors);
  const slowBatches = batchRows.filter((b) => b.ms > BRAIN_TARGET_MS);
  const checksPass = r.checks.every((c) => c.pass);
  const summary = [
    rows.length ? `${failing.length} of ${rows.length} request rows miss the target or had errors` : "",
    batchRows.length ? `${slowBatches.length} of ${batchRows.length} brain batches over ${BRAIN_TARGET_MS / 1000} s, ${fallbacks} fallback(s) to one transaction per item` : "",
    r.csv ? `CSV 2,000 rows ${fu(r.csv.ms)}` : "",
    r.checks.length ? `suppressions paging checks **${checksPass ? "PASS" : "FAIL"}**` : "",
  ].filter(Boolean);
  const lines = [
    FULL ? `## Run ${when(r.startedAt)} UTC: full` : `## Quick run ${when(r.startedAt)} UTC: \`--only ${ONLY}\``,
    ``,
    `- Postgres ${r.version} (local, native), Node ${process.version}, Windows. App pool \`max: ${process.env.DB_POOL_MAX ?? 10}\` (\`DB_POOL_MAX\`, \`src/db.ts\`), connection timeout 5 s (then 503), statement timeout 15 s.`,
    `- **+${LATENCY_MS} ms per round trip** to the database and to Supabase Auth (TCP proxy, \`load/latency.ts\`).`,
    `- Seed: ${WORKSPACES.map((w) => `${w.key} ${w.contacts / 1000}k`).join(" / ")} contacts. All workspaces: ${Object.entries(r.seeded).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(", ")}.`,
    `- Requests as a salesperson member of workspace A (admin for Admin rows); ${RUNS} timed runs after 1 warm-up, one at a time. Times in ms. "SQL" = statements per request (each one a round trip).`,
    `- Targets: p95 ≤ ${TARGET_MS} ms per request or page; brain batch of 500 ≤ ${BRAIN_TARGET_MS / 1000} s.`,
    ``,
    `**Summary:** ${summary.join("; ")}.`,
    ``,
  ];
  if (rows.length) {
    lines.push(
      `### Requests`,
      ``,
      `| Group | Route | p50 | p95 | max | SQL | Errors | |`,
      `|---|---|---:|---:|---:|---:|---:|---|`,
      ...rows.map((x) => `| ${x.group} | ${x.name} | ${f(x.p50)} | ${f(x.p95)} | ${f(x.max)} | ${x.statements} | ${x.errors ? `${x.errors}: ${x.firstError?.replace(/\|/g, "/")}` : 0} | ${x.errors ? "❌" : ok(x.p95, x.target)} |`),
      ``,
    );
  }
  if (batchRows.length) {
    lines.push(
      `### Brain batches (500 items each, workspace A)`,
      ``,
      `| Route | Batch | Time | SQL | Result | Fallbacks | |`,
      `|---|---|---:|---:|---|---:|---|`,
      ...batchRows.map(
        (b) => `| ${b.route} | ${b.batch} | ${(b.ms / 1000).toFixed(1)} s | ${b.statements ?? "not traced"} | ${b.counts} | ${b.fallbacks} | ${b.errors || b.fallbacks ? "❌" : ok(b.ms, BRAIN_TARGET_MS)} |`,
      ),
      ``,
    );
  }
  if (r.csv) lines.push(`### CSV import (2,000 rows, workspace A)`, ``, `${fu(r.csv.ms)}, ${r.csv.statements} SQL, ${r.csv.summary}. ${ok(r.csv.ms, CSV_TARGET_MS)}`, ``);
  if (r.mixed) {
    lines.push(
      `### Mixed load`,
      ``,
      `10 users browsing workspace A (contacts list, deals board, contact, timeline, dashboard, tasks) for ${MIXED_MS / 1000} s while contact batches of 500 run 3 at a time, round after round.`,
      ``,
      `| User requests | p50 | p95 | max | Errors | Brain batches (3 at once) | |`,
      `|---:|---:|---:|---:|---:|---|---|`,
      `| ${r.mixed.requests} | ${f(r.mixed.p50)} | ${f(r.mixed.p95)} | ${f(r.mixed.max)} | ${r.mixed.errors ? `${r.mixed.errors} ❌ (first: ${r.mixed.firstError?.replace(/\|/g, "/")})` : 0} | ${batchSummary(r.mixed.batchMs)} | ${r.mixed.errors ? "❌" : ok(r.mixed.p95, TARGET_MS)} |`,
      ``,
    );
  }
  if (r.checks.length) {
    lines.push(
      `### Suppressions paging checks (workspace C)`,
      ``,
      `Each check follows \`next\` until \`hasMore\` is false. Pass = every expected contact exactly once, no repeated cursor.`,
      ``,
      `| Check | Expected | Rows | Unique | Pages | Cursor | |`,
      `|---|---:|---:|---:|---:|---|---|`,
      ...r.checks.map((c) => `| ${c.name} | ${c.expected} | ${c.rows} | ${c.unique} | ${c.pages} | ${c.stuck ? "stuck ❌" : "moved every page"} | ${c.pass ? "✅" : "❌"} |`),
      ``,
    );
  }
  lines.push(
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
