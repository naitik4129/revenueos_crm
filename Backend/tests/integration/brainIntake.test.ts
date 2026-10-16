/**
 * P2b: the brain intake API (/brain/v1) on the PGlite test database. The brain authenticates
 * with a real key created through the admin route; user requests mock Supabase Auth
 * (a bearer token is the user's id).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));

describe("brain intake API (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let appPool: Pool;
  let admin: string;
  let sam: string;
  let sue: string;
  let ws: string;
  let key: string;

  async function mkUser(email: string, role: "admin" | "salesperson") {
    const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $3)`, [id, email.split("@")[0], email]);
    await seed.query(`insert into crm.profiles (id, role) values ($1, $2)`, [id, role]);
    return id;
  }

  const brain = (path: string, items?: object[], k = key) => {
    const r = items ? request(app).post(`/api/v1/brain/v1${path}`).send({ items }) : request(app).get(`/api/v1/brain/v1${path}`);
    return r.set("Authorization", `Bearer ${k}`);
  };
  const user = (method: "get" | "post" | "patch", path: string, as: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${as}`).set("X-Workspace-Id", ws);
    return body ? r.send(body) : r;
  };
  const one = async (sql: string, params: unknown[] = []) => (await seed.query(sql, params)).rows[0];
  const contactIdOf = async (externalId: string) =>
    (await one(`select contact_id from crm.external_refs where source = 'quickicp' and external_id = $1`, [externalId])).contact_id as string;

  const acme = { source: "quickicp", externalId: "co-1", name: "Acme", website: "https://www.acme.com/about", headcount: 40 };
  const ann = { source: "quickicp", externalId: "p-1", fullName: "Ann Lee", email: "Ann@Acme.com", jobTitle: "Head of Sales", companyRef: { source: "quickicp", externalId: "co-1" } };

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    appPool = (await import("../../src/db.js")).pool;

    admin = await mkUser("admin@x.com", "admin");
    sam = await mkUser("sam@x.com", "salesperson");
    sue = await mkUser("sue@x.com", "salesperson");
    ws = (await seed.query(`insert into crm.workspaces (name, slug) values ('Client', 'client') returning id`)).rows[0].id;
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $2), ($1, $3)`, [ws, sam, sue]);

    const created = await request(app).post(`/api/v1/workspaces/${ws}/brain-keys`).set("Authorization", `Bearer ${admin}`).send({ label: "brain" });
    expect(created.status).toBe(201);
    key = created.body.key;
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await seed?.end();
    await testDb?.stop();
  });

  describe("keys", () => {
    it("are admin-only, stored as a hash, and shown once", async () => {
      expect(key).toMatch(/^nbk_[A-Za-z0-9_-]{43}$/);
      expect((await request(app).post(`/api/v1/workspaces/${ws}/brain-keys`).set("Authorization", `Bearer ${sam}`).send({ label: "x" })).status).toBe(403);
      expect(await one(`select count(*)::int n from crm.brain_api_keys where key_hash = $1 or key_prefix = $1`, [key])).toEqual({ n: 0 });

      expect((await brain("/suppressions")).status).toBe(200);
      const list = (await request(app).get(`/api/v1/workspaces/${ws}/brain-keys`).set("Authorization", `Bearer ${admin}`)).body.data;
      expect(list[0]).toMatchObject({ label: "brain", prefix: key.slice(0, 12), revokedAt: null });
      expect(list[0].lastUsedAt).not.toBeNull();
      expect(list[0].key).toBeUndefined();
    });

    it("rejects a missing, unknown or revoked key with 401", async () => {
      expect((await request(app).get("/api/v1/brain/v1/suppressions")).status).toBe(401);
      expect((await brain("/suppressions", undefined, "nbk_not-a-real-key")).status).toBe(401);
      expect((await brain("/suppressions", undefined, sam)).status).toBe(401); // a user token is not a brain key

      const spare = (await request(app).post(`/api/v1/workspaces/${ws}/brain-keys`).set("Authorization", `Bearer ${admin}`).send({ label: "spare" })).body;
      expect((await brain("/companies", [acme], spare.key)).status).toBe(200);
      await request(app).delete(`/api/v1/workspaces/${ws}/brain-keys/${spare.id}`).set("Authorization", `Bearer ${admin}`);
      const res = await brain("/companies", [acme], spare.key);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/revoked/);
    });
  });

  it("re-sending the same batch updates instead of duplicating", async () => {
    const first = await brain("/companies", [acme]);
    expect(first.body.results[0]).toMatchObject({ externalId: "co-1", status: "updated" }); // created by the key test above
    const c1 = await brain("/contacts", [ann]);
    expect(c1.body).toMatchObject({ counts: { created: 1, updated: 0, error: 0 } });
    const c2 = await brain("/contacts", [ann]);
    expect(c2.body.results[0]).toMatchObject({ status: "updated", id: c1.body.results[0].id });

    expect(await one(`select count(*)::int n from crm.companies where workspace_id = $1`, [ws])).toEqual({ n: 1 });
    expect(await one(`select count(*)::int n from crm.contacts where workspace_id = $1`, [ws])).toEqual({ n: 1 });
    expect(await one(`select count(*)::int n from crm.external_refs where workspace_id = $1`, [ws])).toEqual({ n: 2 });
    const contact = (await user("get", `/contacts/${c1.body.results[0].id}`, sam)).body;
    expect(contact).toMatchObject({ firstName: "Ann", lastName: "Lee", email: "ann@acme.com", companyName: "Acme", source: "brain", lifecycleStage: "prospect" });
    expect(await one(`select domain, headcount from crm.companies where workspace_id = $1`, [ws])).toEqual({ domain: "acme.com", headcount: 40 });
  });

  it("never overwrites a human-edited field; only fills empty ones", async () => {
    const id = await contactIdOf("p-1");
    await user("patch", `/contacts/${id}`, sam, { jobTitle: "CTO" });
    const res = await brain("/contacts", [{ ...ann, jobTitle: "Intern", country: "India", email: "other@acme.com" }]);
    expect(res.body.results[0]).toMatchObject({ status: "updated", id });
    expect(await one(`select job_title, country, email from crm.contacts where id = $1`, [id])).toEqual({ job_title: "CTO", country: "India", email: "ann@acme.com" });
  });

  it("matches a call by the QuickICP id alone; re-sends update the same call", async () => {
    const id = await contactIdOf("p-1");
    const call = { source: "quickhowl", externalId: "call-1", contact: { source: "quickicp", externalId: "p-1" }, connected: true, outcome: "interested", durationSeconds: 95 };
    const res = await brain("/calls", [call, { ...call, externalId: "call-x", contact: { source: "quickicp", externalId: "nobody" } }]);
    expect(res.body.results[0]).toMatchObject({ status: "created" });
    expect(res.body.results[1]).toMatchObject({ status: "error", error: { code: "not_found" } });

    const again = await brain("/calls", [{ ...call, transcript: "Hello Ann...", summary: "Wants a demo" }]);
    expect(again.body.results[0]).toMatchObject({ status: "updated", id: res.body.results[0].id });
    expect(await one(`select contact_id, source, ai_outcome, duration_seconds, transcript, summary from crm.calls where external_id = 'call-1'`)).toEqual({
      contact_id: id,
      source: "ai",
      ai_outcome: "interested",
      duration_seconds: 95,
      transcript: "Hello Ann...",
      summary: "Wants a demo",
    });
    expect(await one(`select count(*)::int n from crm.timeline_events where related_call_id = $1`, [res.body.results[0].id])).toEqual({ n: 1 });
    expect((await user("get", `/contacts/${id}`, sam)).body.lifecycleStage).toBe("engaged");
  });

  it("handover creates a deal, reuses the open deal, and reopens a parked one", async () => {
    const id = await contactIdOf("p-1");
    const handover = { source: "quickicp", externalId: "h-1", contact: { source: "quickicp", externalId: "p-1" }, ownerEmail: "sam@x.com", summary: "Budget approved" };

    const created = await brain("/handovers", [handover]);
    expect(created.body.results[0]).toMatchObject({ status: "created" });
    const dealId = created.body.results[0].id;
    expect((await user("get", `/deals/${dealId}`, sam)).body).toMatchObject({ outcome: "open", ownerId: sam, contactId: id, lifecycleStage: "qualified" });
    expect(await one(`select actor_source, title from crm.timeline_events where deal_id = $1 and event_kind = 'handover'`, [dealId])).toEqual({
      actor_source: "brain",
      title: "Qualified Handover",
    });
    expect((await seed.query(`select recipient_id from crm.notifications where deal_id = $1`, [dealId])).rows).toEqual([{ recipient_id: sam }]);

    expect((await brain("/handovers", [handover])).body.results[0]).toMatchObject({ status: "unchanged", id: dealId });
    expect((await brain("/handovers", [{ ...handover, externalId: "h-2" }])).body.results[0]).toMatchObject({ status: "updated", id: dealId });

    await user("post", `/deals/${dealId}/nurture`, sam);
    const reopened = await brain("/handovers", [{ ...handover, externalId: "h-3" }]);
    expect(reopened.body.results[0]).toMatchObject({ status: "updated", id: dealId });
    expect((await user("get", `/deals/${dealId}`, sam)).body).toMatchObject({ outcome: "open", automationMode: "manual" });
    expect(await one(`select count(*)::int n from crm.deals where contact_id = $1`, [id])).toEqual({ n: 1 });
  });

  it("handover owner: member ownerEmail, else the workspace default owner, else unassigned + notify all members", async () => {
    const person = (n: number) => ({ source: "quickicp", externalId: `p-${n}`, fullName: `Person ${n}`, email: `p${n}@x.com` });
    await seed.query(`update crm.workspaces set default_owner_id = $1 where id = $2`, [sue, ws]);
    const withDefault = await brain("/handovers", [{ source: "quickicp", externalId: "h-10", contact: person(10), ownerEmail: "stranger@x.com", summary: "Fit" }]);
    expect((await user("get", `/deals/${withDefault.body.results[0].id}`, sam)).body.ownerId).toBe(sue);

    await seed.query(`update crm.workspaces set default_owner_id = null where id = $1`, [ws]);
    const unassigned = await brain("/handovers", [{ source: "quickicp", externalId: "h-11", contact: person(11), summary: "Fit" }]);
    const dealId = unassigned.body.results[0].id;
    expect((await user("get", `/deals/${dealId}`, sam)).body.ownerId).toBeUndefined();
    const notified = (await seed.query(`select recipient_id from crm.notifications where deal_id = $1 order by recipient_id`, [dealId])).rows.map((r) => r.recipient_id);
    expect(notified).toEqual([sam, sue].sort());
  });

  it("an unsubscribe (and an AI-call DNC) shows in /suppressions", async () => {
    const event = { source: "email_tool", messageId: "m-1", contact: { source: "quickicp", externalId: "p-1" }, campaignRef: "camp-1", step: 1, event: "sent", occurredAt: "2026-10-01T10:00:00Z" };
    await brain("/email-events", [event]);
    expect((await brain("/suppressions")).body.data.find((s: { email: string }) => s.email === "ann@acme.com")).toBeUndefined();

    const res = await brain("/email-events", [
      { ...event, event: "unsubscribed", occurredAt: "2026-10-02T10:00:00Z" },
      { ...event, event: "bounced", occurredAt: "2026-10-02T11:00:00Z" },
    ]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["updated", "updated"]);
    expect(await one(`select status, sent_at is not null as sent, unsubscribed_at is not null as unsub from crm.email_activities where external_id = 'm-1'`)).toEqual({
      status: "unsubscribed",
      sent: true,
      unsub: true,
    });

    await brain("/calls", [{ source: "quickhowl", externalId: "call-dnc", contact: { phone: "+919811111111", fullName: "Raj K" }, connected: true, dnc: true }]);

    const list = (await brain("/suppressions")).body.data;
    expect(list.find((s: { email: string }) => s.email === "ann@acme.com")).toMatchObject({
      reasons: ["email_unsubscribed"],
      externalIds: [{ source: "quickicp", externalId: "p-1" }],
    });
    expect(list.find((s: { phone: string }) => s.phone === "+919811111111")).toMatchObject({ reasons: ["do_not_contact"] });

    const since = list[0].changedAt;
    const later = (await brain(`/suppressions?since=${encodeURIComponent(since)}`)).body.data;
    expect(later.length).toBe(list.length - 1);
  });

  it("with since, also returns lifted suppressions so the brain can unblock", async () => {
    const before = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 10));
    const annId = await contactIdOf("p-1");
    const rajId = (await one(`select id from crm.contacts where phone_e164 = '+919811111111'`)).id;
    await user("post", `/contacts/${annId}/contactability`, sam, { channel: "email", status: "valid", reason: "Re-subscribed" });
    await user("post", `/contacts/${rajId}/dnc/reactivate`, sam, { reason: "Asked to be called again" });

    const changes = (await brain(`/suppressions?since=${encodeURIComponent(before)}`)).body.data;
    expect(changes.find((s: { contactId: string }) => s.contactId === annId)).toMatchObject({ status: "lifted", reasons: [], email: "ann@acme.com" });
    const raj = changes.find((s: { contactId: string }) => s.contactId === rajId);
    expect(raj).toMatchObject({ status: "lifted", phone: "+919811111111" });
    expect(Date.parse(raj.liftedAt)).toBeGreaterThan(Date.parse(before));

    const full = (await brain("/suppressions")).body.data.map((s: { contactId: string }) => s.contactId);
    expect(full).not.toContain(annId);
    expect(full).not.toContain(rajId);
  });

  it("rejects a batch over 500 items and reports item errors as code + short message only", async () => {
    expect((await brain("/contacts", Array(501).fill(ann))).status).toBe(400);
    const res = await brain("/contacts", [{ source: "quickicp", externalId: "p-20" }, { ...ann, externalId: "p-1" }, { source: "quickicp" }]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["error", "updated", "error"]);
    expect(res.body.results[0].error).toEqual({ code: "not_found", message: expect.stringMatching(/^Contact/) });
    expect(res.body.results[2].error).toEqual({ code: "invalid_input", message: "Invalid: externalId" });

    // A database error (integer out of range) must not leak SQL to the brain.
    const internal = await brain("/companies", [{ source: "quickicp", externalId: "co-big", name: "Huge", headcount: 3_000_000_000 }]);
    expect(internal.body.results[0].error).toEqual({ code: "internal_error", message: "Item failed." });
  });
});
