/**
 * P2b: the brain intake API (/brain/v1) on the PGlite test database. The brain authenticates
 * with a real key created through the admin route; user requests mock Supabase Auth
 * (a bearer token is the user's id).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
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

  // Set-based batches must not quietly fall back to one item at a time (it gives the same results,
  // so only the warning shows it). A test that means to fall back says how many times.
  let warn: MockInstance;
  let expectedFallbacks = 0;
  beforeEach(() => {
    expectedFallbacks = 0;
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    const fallbacks = warn.mock.calls.filter((args) => String(args[0]).startsWith("[brain] Batch fell back")).map((args) => String(args[0]));
    warn.mockRestore();
    expect(fallbacks.length, fallbacks.join("\n")).toBe(expectedFallbacks);
  });

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
      const again = await request(app).delete(`/api/v1/workspaces/${ws}/brain-keys/${spare.id}`).set("Authorization", `Bearer ${admin}`);
      expect(again.status).toBe(200); // revoking twice keeps the first revoke time
      expect(again.body.revokedAt).not.toBeNull();
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

  it("handover amount fills an empty deal amount and never overwrites one", async () => {
    const contact = { source: "quickicp", externalId: "p-30", fullName: "Amount Person", email: "p30@x.com" };
    const first = await brain("/handovers", [{ source: "quickicp", externalId: "h-30", contact, summary: "Fit", amount: 250000 }]);
    const dealId = first.body.results[0].id;
    expect((await user("get", `/deals/${dealId}`, sam)).body).toMatchObject({ amount: 250000, currency: "INR" });

    await brain("/handovers", [{ source: "quickicp", externalId: "h-31", contact, summary: "Bigger", amount: 999999 }]);
    expect((await user("get", `/deals/${dealId}`, sam)).body.amount).toBe(250000);
    expect((await brain("/handovers", [{ source: "quickicp", externalId: "h-32", contact, summary: "Bad", amount: -5 }])).body.results[0]).toMatchObject({ status: "error" });
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

  describe("suppressions paging", () => {
    type Page = { data: { contactId: string; changedAt: string }[]; next: string; hasMore: boolean };
    /** Follows `next` until hasMore is false; every cursor must differ from the one before. */
    async function pageAll(first: string, limit: number) {
      const ids: string[] = [];
      const cursors: string[] = [];
      let path = `${first}${first.includes("?") ? "&" : "?"}limit=${limit}`;
      for (let i = 0; i < 50; i++) {
        const res = await brain(path);
        expect(res.status).toBe(200);
        const page = res.body as Page;
        ids.push(...page.data.map((s) => s.contactId));
        cursors.push(page.next);
        if (!page.hasMore) return { ids, cursors, last: page.next };
        path = `/suppressions?cursor=${page.next}&limit=${limit}`;
      }
      throw new Error("Paging never ended.");
    }
    const people = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ source: "quickicp", externalId: `${prefix}-${i}`, fullName: `Tie ${i}`, email: `${prefix}${i}@tie.com` }));
    /** One statement, so every row gets the same updated_at (a bulk unsubscribe). */
    const bulkUnsubscribe = (ids: string[]) =>
      seed.query(
        `insert into crm.contact_channels (contact_id, channel, status) select unnest($1::uuid[]), 'email', 'unsubscribed'
         on conflict (contact_id, channel) do update set status = 'unsubscribed', updated_at = now()`,
        [ids],
      );

    it("returns rows sharing one timestamp exactly once, and the cursor always moves", async () => {
      await brain("/contacts", people("tie", 7));
      const ids = await Promise.all(Array.from({ length: 7 }, (_, i) => contactIdOf(`tie-${i}`)));
      const before = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 5));
      await bulkUnsubscribe(ids);

      const { ids: got, cursors } = await pageAll(`/suppressions?since=${encodeURIComponent(before)}`, 2);
      expect(got.sort()).toEqual([...ids].sort());
      expect(new Set(cursors).size).toBe(cursors.length);
      const page = (await brain(`/suppressions?since=${encodeURIComponent(before)}&limit=7`)).body as Page;
      expect(new Set(page.data.map((s) => s.changedAt)).size).toBe(1);
      expect(page.data[0]!.changedAt).toMatch(/\.\d{6}Z$/);
    });

    it("pages the full list once each, then carries on as a change feed", async () => {
      const unpaged = ((await brain("/suppressions")).body as Page).data.map((s) => s.contactId);
      const { ids, last } = await pageAll("/suppressions", 3);
      expect(ids).toEqual(unpaged);
      expect(new Set(ids).size).toBe(ids.length);

      await brain("/contacts", people("late", 1));
      const lateId = await contactIdOf("late-0");
      await user("post", `/contacts/${lateId}/dnc`, sam, { reason: "Asked to stop" });
      const feed = ((await brain(`/suppressions?cursor=${last}`)).body as Page).data;
      expect(feed.map((s) => s.contactId)).toContain(lateId);
      expect(feed.map((s) => s.contactId)).not.toContain(ids[0]);
    });

    it("never lists another workspace's contacts", async () => {
      const other = (await seed.query(`insert into crm.workspaces (name, slug) values ('Other', 'other') returning id`)).rows[0].id;
      const outsider = (await seed.query(`insert into crm.contacts (workspace_id, first_name, email) values ($1, 'Out', 'out@other.com') returning id`, [other])).rows[0].id;
      await bulkUnsubscribe([outsider]);
      const { ids } = await pageAll("/suppressions", 1000);
      expect(ids).not.toContain(outsider);
    });

    it("refuses a cursor it did not issue, and since together with cursor", async () => {
      expect((await brain("/suppressions?cursor=not-a-cursor")).status).toBe(400);
      const forged = Buffer.from(JSON.stringify(["c", "2026-10-01T00:00:00Z", "x"])).toString("base64url");
      expect((await brain(`/suppressions?cursor=${forged}`)).status).toBe(400);
      const { last } = await pageAll("/suppressions", 1000);
      expect((await brain(`/suppressions?cursor=${last}&since=2026-10-01T00:00:00Z`)).status).toBe(400);
    });
  });

  describe("set-based batches (same rules as one item at a time)", () => {
    const statuses = (res: { body: { results: { status: string }[] } }) => res.body.results.map((r) => r.status);
    const ids = (res: { body: { results: { id: string }[] } }) => res.body.results.map((r) => r.id);

    it("folds items naming one person in one batch into one contact", async () => {
      const res = await brain("/contacts", [
        { source: "quickicp", externalId: "dup-1", fullName: "Dee Upp", email: "dee@dup.com" },
        { source: "quickicp", externalId: "dup-2", email: "DEE@dup.com", jobTitle: "Founder", phone: "+919800000101" },
        { source: "quickicp", externalId: "dup-1", country: "India" },
      ]);
      expect(statuses(res)).toEqual(["created", "updated", "updated"]);
      expect(new Set(ids(res)).size).toBe(1);
      expect(await one(`select first_name, job_title, phone_e164, country from crm.contacts where id = $1`, [ids(res)[0]])).toEqual({
        first_name: "Dee",
        job_title: "Founder",
        phone_e164: "+919800000101",
        country: "India",
      });
      expect(await one(`select count(*)::int n from crm.external_refs where contact_id = $1`, [ids(res)[0]])).toEqual({ n: 2 });

      const again = await brain("/contacts", [
        { source: "quickicp", externalId: "dup-1", fullName: "Dee Upp", email: "dee@dup.com" },
        { source: "quickicp", externalId: "dup-2", email: "dee@dup.com" },
      ]);
      expect(statuses(again)).toEqual(["updated", "updated"]);
      expect(ids(again)).toEqual([ids(res)[0], ids(res)[0]]);
    });

    it("lets a call name a contact an earlier item of the same batch created", async () => {
      const call = (n: number, contact: object) => ({ source: "quickhowl", externalId: `bc-${n}`, contact, connected: n === 2 });
      const res = await brain("/calls", [
        call(1, { source: "quickicp", externalId: "bc-person", fullName: "Bea Call", email: "bea@call.com" }),
        call(2, { source: "quickicp", externalId: "bc-person" }),
        call(1, { source: "quickicp", externalId: "bc-person" }),
      ]);
      expect(statuses(res)).toEqual(["created", "created", "updated"]);
      expect(ids(res)[2]).toBe(ids(res)[0]);
      const contactId = await contactIdOf("bc-person");
      expect(await one(`select count(*)::int n from crm.calls where contact_id = $1`, [contactId])).toEqual({ n: 2 });
      expect(await one(`select count(*)::int n from crm.timeline_events where contact_id = $1 and event_kind = 'call'`, [contactId])).toEqual({ n: 2 });
      // prospect -> contacted -> engaged, one timeline entry per move
      expect(await one(`select lifecycle_stage from crm.contacts where id = $1`, [contactId])).toEqual({ lifecycle_stage: "engaged" });
      expect(await one(`select count(*)::int n from crm.timeline_events where contact_id = $1 and event_kind = 'lifecycle'`, [contactId])).toEqual({ n: 2 });
    });

    it("folds several events for one message, and never turns an unsubscribe into a bounce", async () => {
      const person = { source: "quickicp", externalId: "em-person", fullName: "Eve Mail", email: "eve@mail.com" };
      const ev = (event: string, minute: number) => ({ source: "email_tool", messageId: "em-1", contact: person, campaignRef: "c-1", event, occurredAt: `2026-10-0${minute}T10:00:00Z` });
      const res = await brain("/email-events", [ev("sent", 1), ev("opened", 2), ev("unsubscribed", 3), ev("bounced", 4), ev("opened", 5)]);
      expect(statuses(res)).toEqual(["created", "updated", "updated", "updated", "updated"]);
      expect(new Set(ids(res)).size).toBe(1);
      expect(await one(`select status, sent_at, opened_at, bounced_at is not null as bounced from crm.email_activities where external_id = 'em-1'`)).toEqual({
        status: "unsubscribed",
        sent_at: new Date("2026-10-01T10:00:00Z"),
        opened_at: new Date("2026-10-02T10:00:00Z"),
        bounced: true,
      });
      const contactId = await contactIdOf("em-person");
      expect(await one(`select status from crm.contact_channels where contact_id = $1 and channel = 'email'`, [contactId])).toEqual({ status: "unsubscribed" });
      const titles = (await seed.query(`select title from crm.timeline_events where contact_id = $1 and event_kind = 'email' order by title`, [contactId])).rows.map((r) => r.title);
      expect(titles).toEqual(["Campaign Email Bounced", "Unsubscribed"]);
    });

    it("follows a merged contact to its target", async () => {
      const made = await brain("/contacts", [
        { source: "quickicp", externalId: "mg-a", fullName: "Mo Keep", email: "keep@merge.com" },
        { source: "quickicp", externalId: "mg-b", fullName: "Mo Gone", email: "gone@merge.com" },
      ]);
      const [keep, gone] = ids(made);
      expect((await user("post", `/contacts/${gone}/merge`, sam, { targetContactId: keep })).status).toBe(200);
      const res = await brain("/contacts", [{ source: "quickicp", externalId: "mg-c", email: "gone@merge.com", jobTitle: "CEO" }]);
      expect(res.body.results[0]).toMatchObject({ status: "updated", id: keep });
      expect(await one(`select job_title from crm.contacts where id = $1`, [keep])).toEqual({ job_title: "CEO" });
    });

    it("falls back to one item at a time on a database error: only the bad item fails", async () => {
      const co = (n: number, extra: object = {}) => ({ source: "quickicp", externalId: `fb-${n}`, name: `Fallback ${n}`, ...extra });
      expectedFallbacks = 1;
      const res = await brain("/companies", [co(1), co(2, { headcount: 3_000_000_000 }), co(3)]);
      expect(statuses(res)).toEqual(["created", "error", "created"]);
      expect(res.body.results[1].error).toEqual({ code: "internal_error", message: "Item failed." });
      expect(await one(`select count(*)::int n from crm.companies where name like 'Fallback %'`)).toEqual({ n: 2 });
    });

    it("runs handovers side by side, but two for one person one after another", async () => {
      const person = (n: number) => ({ source: "quickicp", externalId: `hv-p${n}`, fullName: `Hand Over ${n}`, email: `hv${n}@x.com` });
      const items = [1, 2, 3, 4, 5, 1].map((n, i) => ({ source: "quickicp", externalId: `hv-${i}`, contact: person(n), summary: "Fit" }));
      const res = await brain("/handovers", items);
      expect(statuses(res)).toEqual(["created", "created", "created", "created", "created", "updated"]);
      expect(ids(res)[5]).toBe(ids(res)[0]);
      expect(await one(`select count(*)::int n from crm.deals d join crm.contacts c on c.id = d.contact_id where c.email like 'hv%@x.com'`)).toEqual({ n: 5 });
    });
  });

  it("rejects a batch over 500 items (handovers: 50) and reports item errors as code + short message only", async () => {
    expect((await brain("/contacts", Array(501).fill(ann))).status).toBe(400);
    const tooMany = await brain("/handovers", Array(51).fill({ source: "quickicp", externalId: "h-cap", contact: ann, summary: "Fit" }));
    expect(tooMany.status).toBe(400);
    expect(JSON.stringify(tooMany.body)).toContain("At most 50 items per request.");
    const res = await brain("/contacts", [{ source: "quickicp", externalId: "p-20" }, { ...ann, externalId: "p-1" }, { source: "quickicp" }]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["error", "updated", "error"]);
    expect(res.body.results[0].error).toEqual({ code: "not_found", message: expect.stringMatching(/^Contact/) });
    expect(res.body.results[2].error).toEqual({ code: "invalid_input", message: "Invalid: externalId" });

    // A database error (integer out of range) must not leak SQL to the brain.
    expectedFallbacks = 1;
    const internal = await brain("/companies", [{ source: "quickicp", externalId: "co-big", name: "Huge", headcount: 3_000_000_000 }]);
    expect(internal.body.results[0].error).toEqual({ code: "internal_error", message: "Item failed." });
  });
});
