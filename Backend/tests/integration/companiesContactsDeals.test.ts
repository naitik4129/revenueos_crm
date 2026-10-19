/**
 * P2: companies, contacts and deals over HTTP on the PGlite test database.
 * Only Supabase Auth is mocked: a bearer token is simply the user's id.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));

describe("companies, contacts, deals (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let appPool: Pool;
  let admin: string;
  let sales: string;
  let w1: string;
  let w2: string;

  async function mkUser(email: string, role: "admin" | "salesperson") {
    const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $3)`, [id, email.split("@")[0], email]);
    await seed.query(`insert into crm.profiles (id, role) values ($1, $2)`, [id, role]);
    return id;
  }

  const api = (method: "get" | "post" | "patch" | "delete", path: string, opts: { as?: string; ws?: string; body?: object } = {}) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${opts.as ?? sales}`).set("X-Workspace-Id", opts.ws ?? w1);
    return opts.body ? r.send(opts.body) : r;
  };
  const newContact = async (body: object, ws = w1) => {
    const res = await api("post", "/contacts", { body: { firstName: "Test", ...body }, ws });
    expect(res.status).toBe(201);
    return res.body as { id: string; lifecycleStage: string; status: string };
  };
  const newDeal = async (contactId: string, ws = w1) => {
    const res = await api("post", "/deals", { body: { contactId }, ws });
    expect(res.status).toBe(201);
    return res.body as { id: string; outcome: string; automationMode: string };
  };
  const seedTask = async (dealId: string | null, contactId: string | null, ws = w1) =>
    (
      await seed.query(
        `insert into crm.tasks (workspace_id, deal_id, contact_id, task_type, title, due_at) values ($1, $2, $3, 'call', 'Call', now()) returning id`,
        [ws, dealId, contactId],
      )
    ).rows[0].id as string;
  const row = async (sql: string, params: unknown[]) => (await seed.query(sql, params)).rows[0];

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    appPool = (await import("../../src/db.js")).pool;

    admin = await mkUser("admin@x.com", "admin");
    sales = await mkUser("sam@x.com", "salesperson");
    w1 = (await seed.query(`insert into crm.workspaces (name, slug) values ('One', 'one') returning id`)).rows[0].id;
    w2 = (await seed.query(`insert into crm.workspaces (name, slug) values ('Two', 'two') returning id`)).rows[0].id;
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $3), ($2, $3)`, [w1, w2, sales]);
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await seed?.end();
    await testDb?.stop();
  });

  it("allows one open deal per contact (409), also when reopening a parked deal", async () => {
    const c = await newContact({ email: "one@x.com" });
    const first = await newDeal(c.id);

    const second = await api("post", "/deals", { body: { contactId: c.id } });
    expect(second.status).toBe(409);
    expect(second.body.error.details).toEqual({ reason: "open_deal_exists", dealId: first.id });

    expect((await api("post", `/deals/${first.id}/nurture`)).body.outcome).toBe("nurture");
    const replacement = await newDeal(c.id);
    expect((await api("post", `/deals/${first.id}/reopen`)).status).toBe(409);
    await api("post", `/deals/${replacement.id}/lost`, { body: { lossReason: "no_urgency" } });
    expect((await api("post", `/deals/${first.id}/reopen`)).body).toMatchObject({ outcome: "open", automationMode: "manual" });
  });

  it("deal amount (INR): set, cleared and refused when negative; setting it is not activity", async () => {
    const deal = await newDeal((await newContact({ email: "amount@x.com" })).id);
    await seed.query(`update crm.deals set last_activity_at = '2026-01-01T00:00:00Z' where id = $1`, [deal.id]);

    const set = await api("patch", `/deals/${deal.id}`, { body: { amount: 450000.5 } });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ amount: 450000.5, currency: "INR", lastActivityAt: "2026-01-01T00:00:00.000Z" });
    expect((await api("get", "/deals?outcome=open")).body.data.find((d: { id: string }) => d.id === deal.id).amount).toBe(450000.5);

    expect((await api("patch", `/deals/${deal.id}`, { body: { amount: -1 } })).status).toBe(400);
    expect((await api("patch", `/deals/${deal.id}`, { body: { amount: "1000" } })).status).toBe(400);
    expect((await api("patch", `/deals/${deal.id}`, { body: { amount: null } })).body.amount).toBeNull();
    await expect(seed.query(`update crm.deals set currency = 'USD' where id = $1`, [deal.id])).rejects.toThrow(/deals_currency_inr/);
  });

  it("assigning an owner is not activity (contacts and deals); other field edits still are", async () => {
    const OLD = "2026-01-01T00:00:00.000Z";
    const contact = await newContact({ lastName: "Owner", email: "owner-test@x.com", jobTitle: "CEO" });
    const deal = await newDeal(contact.id);
    const reset = () =>
      Promise.all([
        seed.query(`update crm.contacts set last_activity_at = $2 where id = $1`, [contact.id, OLD]),
        seed.query(`update crm.deals set last_activity_at = $2 where id = $1`, [deal.id, OLD]),
      ]);
    const contactActivity = async () => (await api("get", `/contacts/${contact.id}`)).body.lastActivityAt;
    const dealActivity = async () => (await api("get", `/deals/${deal.id}`)).body.lastActivityAt;

    // Contact: the owner alone (single edit, or a bulk-assign PATCH), and the edit form saving
    // every field unchanged plus a new owner, leave last activity alone.
    await reset();
    expect((await api("patch", `/contacts/${contact.id}`, { body: { ownerId: admin } })).status).toBe(200);
    expect(await contactActivity()).toBe(OLD);
    const { source } = (await api("get", `/contacts/${contact.id}`)).body;
    const form = { firstName: "Test", lastName: "Owner", email: "owner-test@x.com", jobTitle: "CEO", source };
    expect((await api("patch", `/contacts/${contact.id}`, { body: { ...form, ownerId: sales } })).status).toBe(200);
    expect(await contactActivity()).toBe(OLD);
    expect(await row(`select count(*)::int n from crm.timeline_events where contact_id = $1 and title = 'Contact Assigned'`, [contact.id])).toEqual({ n: 2 });
    // A real field change is activity.
    expect((await api("patch", `/contacts/${contact.id}`, { body: { jobTitle: "CTO" } })).status).toBe(200);
    expect(await contactActivity()).not.toBe(OLD);

    // Deal: same rule.
    await reset();
    expect((await api("patch", `/deals/${deal.id}`, { body: { ownerId: admin } })).status).toBe(200);
    expect((await api("patch", `/deals/${deal.id}`, { body: { ownerId: null } })).status).toBe(200);
    expect(await dealActivity()).toBe(OLD);
    expect((await api("patch", `/deals/${deal.id}`, { body: { serviceInterest: "Lead generation" } })).status).toBe(200);
    expect(await dealActivity()).not.toBe(OLD);
  });

  it("board moves: stage changes on an open deal; objection nurture without a type and closed deals are refused", async () => {
    const c = await newContact({ email: "board@x.com" });
    const deal = await newDeal(c.id);
    const move = (stage: string) => api("patch", `/deals/${deal.id}`, { body: { stage } });

    expect((await move("negotiation")).body.stage).toBe("negotiation");
    const objection = await move("objection_nurture");
    expect(objection.status).toBe(422);
    expect(objection.body.error.message).toMatch(/objection type/);

    await api("post", `/deals/${deal.id}/won`);
    const closed = await move("new");
    expect(closed.status).toBe(422);
    expect((await api("get", `/deals/${deal.id}`)).body.stage).toBe("negotiation");
  });

  it("DNC keeps the deal open, stops its automation and cancels open tasks", async () => {
    const c = await newContact({ email: "dnc@x.com" });
    const d = await newDeal(c.id);
    expect((await api("post", `/deals/${d.id}/automation`, { body: { mode: "active" } })).body.automationMode).toBe("active");
    const task = await seedTask(d.id, c.id);

    const res = await api("post", `/contacts/${c.id}/dnc`, { body: { reason: "Asked us to stop" } });
    expect(res.body).toMatchObject({ status: "do_not_contact", doNotContact: true, dncReason: "Asked us to stop" });
    expect((await api("get", `/deals/${d.id}`)).body).toMatchObject({ outcome: "open", automationMode: "stopped" });
    expect(await row(`select status from crm.tasks where id = $1`, [task])).toEqual({ status: "cancelled" });
    expect((await api("post", `/deals/${d.id}/automation`, { body: { mode: "active" } })).status).toBe(409);

    const lifted = await api("post", `/contacts/${c.id}/dnc/reactivate`, { body: { reason: "Opted back in" } });
    expect(lifted.body).toMatchObject({ status: "active", doNotContact: false });
    expect(await row(`select count(*)::int n from crm.dnc_events where contact_id = $1`, [c.id])).toEqual({ n: 2 });
  });

  it("merge moves deals and their tasks to the target and copies DNC", async () => {
    const source = await newContact({ email: "dup@x.com" });
    const target = await newContact({ email: "main@x.com" });
    const deal = await newDeal(source.id);
    const task = await seedTask(deal.id, source.id);
    const contactTask = await seedTask(null, source.id);
    await api("post", `/contacts/${source.id}/notes`, { body: { body: "Met at the expo" } });
    await api("post", `/contacts/${source.id}/dnc`, { body: { reason: "Unsubscribed" } });

    const res = await api("post", `/contacts/${source.id}/merge`, { body: { targetContactId: target.id } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.id, status: "do_not_contact", openDealId: deal.id, lifecycleStage: "qualified" });
    expect(res.body.dncReason).toMatch(/Merged from a Do Not Contact contact: Unsubscribed/);

    expect(await row(`select contact_id from crm.deals where id = $1`, [deal.id])).toEqual({ contact_id: target.id });
    expect(await row(`select contact_id from crm.tasks where id = $1`, [task])).toEqual({ contact_id: target.id });
    expect(await row(`select contact_id from crm.tasks where id = $1`, [contactTask])).toEqual({ contact_id: target.id });
    expect((await api("get", `/contacts/${target.id}/notes`)).body.data.map((n: { body: string }) => n.body)).toEqual(["Met at the expo"]);
    expect((await api("get", `/contacts/${source.id}`)).body).toMatchObject({ status: "merged", mergedIntoContactId: target.id });
  });

  it("blocks a merge when both contacts have an open deal", async () => {
    const a = await newContact({ email: "a@x.com" });
    const b = await newContact({ email: "b@x.com" });
    await newDeal(a.id);
    await newDeal(b.id);
    const res = await api("post", `/contacts/${a.id}/merge`, { body: { targetContactId: b.id } });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Both contacts have an open deal/);
    expect((await api("get", `/contacts/${a.id}`)).body.status).toBe("active");
  });

  it("CSV import dedups by email and phone, reuses companies and opens deals only for rows that ask", async () => {
    await newContact({ email: "existing@x.com", phone: "+919800000001" });
    const res = await api("post", "/contacts/import", {
      body: {
        rows: [
          { rowNumber: 1, firstName: "Ann", email: "ann@acme.com", company: "Acme", source: "event", createDeal: "yes" },
          { rowNumber: 2, firstName: "Ben", phone: "9800000002", company: "ACME" },
          { rowNumber: 8, firstName: "Cat", email: "cat@acme.com", company: "Acme", dealTitle: "Website rebuild" },
          { rowNumber: 9, firstName: "Dan", email: "dan@acme.com", company: "Acme", createDeal: "no" },
          { rowNumber: 3, firstName: "Dup", email: "EXISTING@x.com" },
          { rowNumber: 4, firstName: "Dup", phone: "09800000001" },
          { rowNumber: 5, firstName: "Again", phone: "+91 98000 00002" },
          { rowNumber: 6, firstName: "", email: "noname@x.com" },
          { rowNumber: 7, firstName: "Old", email: "old@x.com", source: "website" },
        ],
      },
    });
    expect(res.status).toBe(201);
    const { created, duplicates, failed, totalRows } = res.body.data;
    expect(totalRows).toBe(9);
    expect(created).toHaveLength(4);
    expect(duplicates).toEqual([
      { rowNumber: 3, reason: "Matches an existing contact by email or phone." },
      { rowNumber: 4, reason: "Matches an existing contact by email or phone." },
      { rowNumber: 5, reason: "Duplicate of another row earlier in this file." },
    ]);
    expect(failed.map((f: { rowNumber: number }) => f.rowNumber)).toEqual([6, 7]);

    const companies = await seed.query(`select id from crm.companies where workspace_id = $1 and lower(name) = 'acme'`, [w1]);
    expect(companies.rows).toHaveLength(1);
    const imported = await seed.query(
      `select c.first_name, c.company_id, c.lifecycle_stage, d.service_interest,
              (select count(*)::int from crm.deals x where x.contact_id = c.id) deals
         from crm.contacts c left join crm.deals d on d.contact_id = c.id
        where c.id = any($1::uuid[]) order by c.first_name`,
      [created],
    );
    const acme = companies.rows[0].id;
    expect(imported.rows).toEqual([
      { first_name: "Ann", company_id: acme, lifecycle_stage: "qualified", service_interest: null, deals: 1 },
      { first_name: "Ben", company_id: acme, lifecycle_stage: "prospect", service_interest: null, deals: 0 },
      { first_name: "Cat", company_id: acme, lifecycle_stage: "qualified", service_interest: "Website rebuild", deals: 1 },
      { first_name: "Dan", company_id: acme, lifecycle_stage: "prospect", service_interest: null, deals: 0 },
    ]);
  });

  it("lifecycle only moves forward automatically; only an admin can move it back, with a note", async () => {
    const c = await newContact({ email: "life@x.com" });
    expect(c.lifecycleStage).toBe("prospect");
    const d = await newDeal(c.id);
    expect((await api("get", `/contacts/${c.id}`)).body.lifecycleStage).toBe("qualified");

    // A manual email would advance to `contacted`, which is behind `qualified`: no change.
    await api("post", `/contacts/${c.id}/communications`, { body: { channel: "email" } });
    expect((await api("get", `/contacts/${c.id}`)).body.lifecycleStage).toBe("qualified");

    expect((await api("post", `/contacts/${c.id}/lifecycle`, { body: { stage: "contacted", note: "x" } })).status).toBe(403);
    expect((await api("post", `/contacts/${c.id}/lifecycle`, { as: admin, body: { stage: "contacted" } })).status).toBe(400);
    const back = await api("post", `/contacts/${c.id}/lifecycle`, { as: admin, body: { stage: "contacted", note: "Handover was premature" } });
    expect(back.body.lifecycleStage).toBe("contacted");
    const timeline = (await api("get", `/contacts/${c.id}/timeline`)).body.data;
    expect(timeline[0]).toMatchObject({ kind: "lifecycle", title: "Lifecycle: qualified -> contacted (moved back)", detail: "Handover was premature" });

    await api("post", `/deals/${d.id}/won`);
    expect((await api("get", `/contacts/${c.id}`)).body.lifecycleStage).toBe("customer");
  });

  it("isolates workspaces: another workspace's ids give 404", async () => {
    const other = await newContact({ email: "other@x.com" }, w2);
    const otherDeal = await newDeal(other.id, w2);
    const otherCompany = (await api("post", "/companies", { ws: w2, body: { name: "Other Co" } })).body.id as string;
    const mine = await newContact({ email: "mine@x.com" });

    const notFound = [
      await api("get", `/contacts/${other.id}`),
      await api("patch", `/contacts/${other.id}`, { body: { jobTitle: "CEO" } }),
      await api("post", `/contacts/${other.id}/dnc`, { body: { reason: "x" } }),
      await api("delete", `/contacts/${other.id}`),
      await api("get", `/deals/${otherDeal.id}`),
      await api("post", `/deals/${otherDeal.id}/won`),
      await api("get", `/companies/${otherCompany}`),
      await api("post", "/deals", { body: { contactId: other.id } }),
      await api("post", `/contacts/${mine.id}/merge`, { body: { targetContactId: other.id } }),
      await api("patch", `/contacts/${mine.id}`, { body: { companyId: otherCompany } }),
      await api("get", `/contacts/not-a-uuid`),
    ];
    expect(notFound.map((r) => r.status)).toEqual(Array(notFound.length).fill(404));

    expect((await api("get", "/contacts", { ws: w2 })).body.data.map((c: { id: string }) => c.id)).toEqual([other.id]);
    expect((await api("get", `/deals/${otherDeal.id}`, { ws: w2 })).body.outcome).toBe("open");
  });

  it("deletes a contact with an audit snapshot and lists contacts with paging", async () => {
    const c = await newContact({ email: "gone@x.com" });
    await newDeal(c.id);
    expect((await api("delete", `/contacts/${c.id}`)).status).toBe(204);
    expect((await api("get", `/contacts/${c.id}`)).status).toBe(404);
    expect(await row(`select entity_type, snapshot->>'email' as email from crm.deleted_records_audit where entity_id = $1`, [c.id])).toEqual({
      entity_type: "contact",
      email: "gone@x.com",
    });

    const pageOne = (await api("get", "/contacts?limit=2&offset=0")).body;
    expect(pageOne.data).toHaveLength(2);
    expect(pageOne.total).toBeGreaterThan(2);
  });

  it("search matches a full name, as well as email, phone and company", async () => {
    await newContact({ firstName: "Zara", lastName: "Quill", email: "zq@x.com" });
    const names = async (q: string) =>
      (await api("get", `/contacts?search=${encodeURIComponent(q)}`)).body.data.map((c: { lastName: string }) => c.lastName);
    expect(await names("zara quill")).toEqual(["Quill"]);
    expect(await names("Quill")).toEqual(["Quill"]);
    expect(await names("zq@x")).toEqual(["Quill"]);
  });

  it("deal search matches the contact's full name", async () => {
    const c = await newContact({ firstName: "Yuri", lastName: "Vance", email: "yv@x.com" });
    const deal = await newDeal(c.id);
    const found = (await api("get", `/deals?search=${encodeURIComponent("yuri vance")}`)).body.data.map((d: { id: string }) => d.id);
    expect(found).toEqual([deal.id]);
  });

  it("companies: search by name/domain/industry, filter by industry, list industries, 409 on a duplicate domain", async () => {
    const mk = async (body: object, ws = w1) => {
      const res = await api("post", "/companies", { body, ws });
      expect(res.status).toBe(201);
      return res.body as { id: string; domain?: string };
    };
    const kilo = await mk({ name: "Kilo Labs", website: "https://www.kilolabs.io/about", industry: "Robotics" });
    expect(kilo.domain).toBe("kilolabs.io");
    await mk({ name: "Lima Foods", domain: "limafoods.com", industry: "robotics " });
    await mk({ name: "Mike Corp", industry: "Retail" });
    await mk({ name: "Other WS", industry: "Mining" }, w2);

    const names = async (query: string) =>
      (await api("get", `/companies?${query}`)).body.data.map((c: { name: string }) => c.name);
    expect(await names("search=kilolabs")).toEqual(["Kilo Labs"]);
    expect(await names("search=retail")).toEqual(["Mike Corp"]);
    expect(await names("industry=ROBOTICS")).toEqual(["Kilo Labs", "Lima Foods"]);
    // One entry per industry, case-insensitively; another workspace's industries are not listed.
    expect((await api("get", "/companies/industries")).body.data).toEqual(["Retail", "Robotics"]);

    const dup = await api("post", "/companies", { body: { name: "Kilo Again", website: "kilolabs.io" } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toEqual({ field: "domain" });
  });
});
