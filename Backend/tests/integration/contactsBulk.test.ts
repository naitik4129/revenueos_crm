/**
 * POST /contacts/bulk (gap 4) over HTTP on the PGlite test database: one action on many
 * contacts, one transaction, a result per id, the same rules as the single actions.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));

describe("bulk contact actions (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let appPool: Pool;
  let admin: string;
  let sales: string;
  let sue: string;
  let gone: string;
  let ws: string;
  let other: string;
  let n = 0;

  async function mkUser(email: string, role: "admin" | "salesperson") {
    const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $3)`, [id, email.split("@")[0], email]);
    await seed.query(`insert into crm.profiles (id, role) values ($1, $2)`, [id, role]);
    return id;
  }
  const api = (method: "get" | "post", path: string, opts: { as?: string; ws?: string; body?: object } = {}) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${opts.as ?? sales}`).set("X-Workspace-Id", opts.ws ?? ws);
    return opts.body ? r.send(opts.body) : r;
  };
  const bulk = (body: object, as?: string) => api("post", "/contacts/bulk", { body, as });
  const newContacts = async (count: number, inWs = ws) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const res = await api("post", "/contacts", { ws: inWs, body: { firstName: "Bulk", email: `bulk${++n}@x.com` } });
      expect(res.status).toBe(201);
      ids.push(res.body.id);
    }
    return ids;
  };
  const one = async (sql: string, params: unknown[]) => (await seed.query(sql, params)).rows[0];
  const audits = async (action: string) =>
    (await seed.query(`select metadata from crm.admin_audit_events where action = $1 order by created_at`, [action])).rows.map((r) => r.metadata);

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    appPool = (await import("../../src/db.js")).pool;
    admin = await mkUser("admin@x.com", "admin");
    sales = await mkUser("sam@x.com", "salesperson");
    sue = await mkUser("sue@x.com", "salesperson");
    gone = await mkUser("gone@x.com", "salesperson");
    ws = (await seed.query(`insert into crm.workspaces (name, slug) values ('One', 'one') returning id`)).rows[0].id;
    other = (await seed.query(`insert into crm.workspaces (name, slug) values ('Two', 'two') returning id`)).rows[0].id;
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $2), ($1, $3), ($1, $4), ($5, $2)`, [ws, sales, sue, gone, other]);
    await seed.query(`update crm.profiles set is_active = false where id = $1`, [gone]);
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await seed?.end();
    await testDb?.stop();
  });

  it("owner: an active member only; last activity stays; same owner, other workspace and unknown ids are skipped", async () => {
    const ids = await newContacts(3);
    const [foreign] = await newContacts(1, other);
    await seed.query(`update crm.contacts set last_activity_at = '2026-01-01T00:00:00Z' where id = any($1::uuid[])`, [ids]);
    await seed.query(`update crm.contacts set owner_id = $2 where id = $1`, [ids[2], sue]);

    expect((await bulk({ action: "owner", ids, ownerId: gone })).status).toBe(400); // inactive
    expect((await bulk({ action: "owner", ids, ownerId: admin })).status).toBe(400); // not a member
    const unknown = "00000000-0000-4000-8000-000000000000";
    const res = await bulk({ action: "owner", ids: [...ids, foreign, unknown], ownerId: sue });
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ ok: 2, skipped: 3 });
    expect(res.body.results).toEqual([
      { id: ids[0], status: "ok" },
      { id: ids[1], status: "ok" },
      { id: ids[2], status: "skipped", reason: "Already has this owner." },
      { id: foreign, status: "skipped", reason: "Contact not found." },
      { id: unknown, status: "skipped", reason: "Contact not found." },
    ]);
    const rows = await seed.query(`select owner_id, last_activity_at from crm.contacts where id = any($1::uuid[]) order by id`, [ids]);
    expect(rows.rows.every((r) => r.owner_id === sue && r.last_activity_at.toISOString() === "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(await one(`select count(*)::int n from crm.timeline_events where contact_id = $1 and title = 'Contact Assigned'`, [ids[0]])).toEqual({ n: 1 });
    // Unassign.
    expect((await bulk({ action: "owner", ids: [ids[0]], ownerId: null })).body.counts).toEqual({ ok: 1, skipped: 0 });
    // One audit row per request, not per contact.
    expect(await audits("contacts.bulk.owner")).toEqual([
      expect.objectContaining({ workspaceId: ws, count: 5, ok: 2, skipped: 3, args: { ownerId: sue } }),
      expect.objectContaining({ count: 1, ok: 1, args: { ownerId: null } }),
    ]);
  });

  it("lifecycle: forward for anyone; back only for an admin, with a note", async () => {
    const ids = await newContacts(2);
    const fwd = await bulk({ action: "lifecycle", ids, stage: "engaged" });
    expect(fwd.body.counts).toEqual({ ok: 2, skipped: 0 });
    const back = await bulk({ action: "lifecycle", ids, stage: "contacted", note: "x" });
    expect(back.body.results[0]).toEqual({ id: ids[0], status: "skipped", reason: "Only an admin can move a lifecycle stage back." });
    expect((await bulk({ action: "lifecycle", ids, stage: "contacted" }, admin)).body.results[0].reason).toBe("A note is required to move a lifecycle stage back.");
    const ok = await bulk({ action: "lifecycle", ids, stage: "contacted", note: "Premature" }, admin);
    expect(ok.body.counts).toEqual({ ok: 2, skipped: 0 });
    expect(await one(`select title, detail from crm.timeline_events where contact_id = $1 order by occurred_at desc, id desc limit 1`, [ids[0]])).toEqual({
      title: "Lifecycle: engaged -> contacted (moved back)",
      detail: "Premature",
    });
    expect((await bulk({ action: "lifecycle", ids, stage: "contacted" })).body.results[0].reason).toBe("Already at this stage.");
  });

  it("DNC: a reason is required; history, tasks and automation like a single DNC; lifting in bulk is admin-only", async () => {
    const ids = await newContacts(2);
    const deal = (await api("post", "/deals", { body: { contactId: ids[0] } })).body;
    expect((await bulk({ action: "dnc", ids, reason: "" })).status).toBe(400);
    const res = await bulk({ action: "dnc", ids, reason: "Asked to stop" });
    expect(res.body.counts).toEqual({ ok: 2, skipped: 0 });
    expect((await bulk({ action: "dnc", ids, reason: "Again" })).body.results[0]).toEqual({ id: ids[0], status: "skipped", reason: "Already Do Not Contact." });
    expect(await one(`select count(*)::int n from crm.dnc_events where contact_id = any($1::uuid[]) and action = 'suppressed'`, [ids])).toEqual({ n: 2 });
    expect(await one(`select count(*)::int n from crm.tasks where deal_id = $1 and status = 'open'`, [deal.id])).toEqual({ n: 0 });
    expect(await one(`select outcome from crm.deals where id = $1`, [deal.id])).toEqual({ outcome: "open" });

    expect((await bulk({ action: "dnc", ids, reason: "Consent given", lift: true })).status).toBe(403);
    const lift = await bulk({ action: "dnc", ids, reason: "Consent given", lift: true }, admin);
    expect(lift.body.counts).toEqual({ ok: 2, skipped: 0 });
    expect(await one(`select status from crm.contacts where id = $1`, [ids[1]])).toEqual({ status: "active" });
  });

  it("delete: admin only, confirmed by the count; an open deal is skipped unless force; an audit snapshot per contact", async () => {
    const ids = await newContacts(3);
    await api("post", "/deals", { body: { contactId: ids[0] } });
    expect((await bulk({ action: "delete", ids, confirm: 3 })).status).toBe(403);
    expect((await bulk({ action: "delete", ids, confirm: 2 }, admin)).status).toBe(400);
    const res = await bulk({ action: "delete", ids, confirm: 3 }, admin);
    expect(res.body.results[0]).toEqual({ id: ids[0], status: "skipped", reason: "Has an open deal (delete with force to remove it anyway)." });
    expect(res.body.counts).toEqual({ ok: 2, skipped: 1 });
    const forced = await bulk({ action: "delete", ids: [ids[0]], confirm: 1, force: true }, admin);
    expect(forced.body.counts).toEqual({ ok: 1, skipped: 0 });
    expect(await one(`select count(*)::int n from crm.contacts where id = any($1::uuid[])`, [ids])).toEqual({ n: 0 });
    expect(await one(`select count(*)::int n from crm.deleted_records_audit where entity_id = any($1::uuid[])`, [ids])).toEqual({ n: 3 });
    expect(await one(`select count(*)::int n from crm.deals where contact_id = $1`, [ids[0]])).toEqual({ n: 0 });
  });

  it("takes at most 500 ids, de-duplicated; an unknown action is 400", async () => {
    const big = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await bulk({ action: "owner", ids: big, ownerId: null })).status).toBe(400);
    const [id] = await newContacts(1);
    const res = await bulk({ action: "lifecycle", ids: [id, id], stage: "engaged" });
    expect(res.body.results).toEqual([{ id, status: "ok" }]);
    expect((await bulk({ action: "archive", ids: [id] })).status).toBe(400);
  });
});
