/**
 * Brain feed reader (brain-feed.service.ts) on the PGlite test database. The brain_feed_* views of
 * migration 018 read tables the test database does not have, so stand-in tables with the same
 * columns play the views here: the reader only depends on those columns (the contract).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

describe("brain feed reader: companies and people (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let feed: typeof import("../../src/services/brain-feed.service.js");
  let ws: string;
  let other: string;
  let sam: string;

  const one = async (sql: string, params: unknown[] = []) => (await seed.query(sql, params)).rows[0];
  const count = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);
  const contactOf = async (personId: string) =>
    one(
      `select c.* from crm_contacts c join crm_external_refs r on r.contact_id = c.id
        where r.workspace_id = $1 and r.source = 'quickicp' and r.external_id = $2`,
      [ws, personId],
    );

  async function project(customer: string | null) {
    return (await one(`insert into public.revenueos_projects (customer_name, brain_customer_key) values ($1, $2) returning id`, [customer ?? "none", customer])).id as string;
  }
  async function workspace(name: string, projectId: string | null) {
    return (await one(`insert into crm_workspaces (name, slug, platform_project_id) values ($1, lower($1), $2) returning id`, [name, projectId])).id as string;
  }
  const company = (id: number, customer: string, name: string, extra: Record<string, unknown> = {}, at = "2026-10-01T10:00:00Z") =>
    seed.query(
      `insert into brain_feed_companies (id, customer, name, website, industry, location, headcount, phone, linkedin_url, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [id, customer, name, extra.website ?? null, extra.industry ?? null, extra.location ?? null, extra.headcount ?? null, null, null, at],
    );
  const person = (id: number, customer: string, fields: Record<string, unknown>, at = "2026-10-01T10:00:00Z") =>
    seed.query(
      `insert into brain_feed_people (id, customer, company_id, full_name, job_title, email, phone, linkedin_url, country, location, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [id, customer, fields.company_id ?? null, fields.full_name ?? null, fields.job_title ?? null, fields.email ?? null, fields.phone ?? null, fields.linkedin_url ?? null, fields.country ?? null, fields.location ?? null, at],
    );
  const runFor = (workspaceId: string, customer: string, name: import("../../src/services/brain-feed.service.js").Feed, pageSize?: number) =>
    feed.syncFeed({ workspaceId, customer }, name, { pageSize });

  let callSeq = 0;
  /** A finished Quickhowl call in brain_feed_calls; returns its id. */
  async function call(fields: { phone: string; outcome: string; status?: string; connected?: boolean; summary?: string; name?: string; email?: string }, at = "2026-10-09T10:00:00Z") {
    const id = `00000000-0000-4000-8000-${String(++callSeq).padStart(12, "0")}`;
    await seed.query(
      `insert into brain_feed_calls (id, customer, phone, contact_name, contact_email, direction, status, outcome, connected,
         started_at, duration_seconds, summary, created_at, updated_at)
       values ($1, 'acme-key', $2, $3, $4, 'outbound', $5, $6, $7, $8, 95, $9, $8, $8)`,
      [id, fields.phone, fields.name ?? null, fields.email ?? null, fields.status ?? "completed", fields.outcome, fields.connected ?? true, at, fields.summary ?? null],
    );
    return id;
  }
  const crmCall = (quickhowlId: string) => one(`select * from crm_calls where workspace_id = $1 and external_source = 'quickhowl' and external_id = $2`, [ws, quickhowlId]);
  const openTasks = (where: string, params: unknown[]) =>
    seed.query(`select task_type, title, owner_id, due_at, deal_id, contact_id from crm_tasks where status = 'open' and ${where} order by created_at`, params).then((r) => r.rows);

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    // Stand-ins for the views of 018: same names and columns.
    await seed.query(`
      create table public.brain_feed_companies (
        id bigint primary key, customer text not null, name text, website text, industry text, location text,
        headcount integer, phone text, linkedin_url text, created_at timestamptz not null, updated_at timestamptz not null);
      create table public.brain_feed_people (
        id bigint primary key, customer text not null, company_id bigint, full_name text, job_title text, email text,
        phone text, linkedin_url text, country text, location text, created_at timestamptz not null, updated_at timestamptz not null);
      create table public.brain_feed_calls (
        id uuid primary key, customer text not null, campaign_id uuid, phone text, contact_name text, contact_email text,
        contact_company text, direction text, status text, outcome text, connected boolean not null, started_at timestamptz,
        answered_at timestamptz, ended_at timestamptz, duration_seconds integer, summary text, sentiment text, extracted_data jsonb,
        recording_url text, transcript text, created_at timestamptz not null, updated_at timestamptz not null);
      create table public.brain_feed_emails (
        id uuid primary key, customer text not null, campaign_id uuid, campaign_name text, step integer, subject text,
        to_email text, enrollment_id uuid, sent_at timestamptz, opened_at timestamptz, bounced_at timestamptz, bounce_type text,
        created_at timestamptz not null, updated_at timestamptz not null);
      create table public.brain_feed_email_outcomes (
        id uuid primary key, customer text not null, campaign_id uuid, enrollment_id uuid, kind text, occurred_at timestamptz,
        email text, reply_subject text, reply_text text, created_at timestamptz not null, updated_at timestamptz not null);
    `);
    feed = await import("../../src/services/brain-feed.service.js");
    ws = await workspace("Acme Client", await project("acme-key"));
    sam = (await one(`insert into auth.users (email) values ('sam@motm.in') returning id`)).id;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, 'Sam Sales', 'sam@motm.in')`, [sam]);
    await seed.query(`insert into crm_profiles (id, role) values ($1, 'salesperson')`, [sam]);
    await seed.query(`insert into crm_workspace_members (workspace_id, user_id) values ($1, $2)`, [ws, sam]);
    await seed.query(`update crm_workspaces set default_owner_id = $2 where id = $1`, [ws, sam]);
    other = await workspace("Other Client", await project("other-key"));
    await workspace("No Project", null);
    await workspace("No Key", await project(null));
  }, 60_000);

  afterAll(async () => {
    await seed?.end();
    await (await import("../../src/db.js")).pool.end();
    await testDb?.stop();
  });

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("takes part only for workspaces linked to a project with a brain key", async () => {
    const list = await feed.feedWorkspaces();
    expect(list.map((w) => w.customer).sort()).toEqual(["acme-key", "other-key"]);
    expect(list.find((w) => w.customer === "acme-key")?.workspaceId).toBe(ws);
  });

  it("copies companies, then people linked to them, as prospects from the brain; other customers' rows stay out", async () => {
    await company(1, "acme-key", "Kilo Robotics", { website: "https://www.kilorobotics.io/", industry: "Robotics", location: "Pune", headcount: 120 });
    await company(2, "acme-key", "Lima Foods", { website: "limafoods.in" });
    await company(3, "other-key", "Not Acme", { website: "notacme.com" });
    await person(10, "acme-key", { company_id: 1, full_name: "Riya Shah", job_title: "Head of Sales", email: "Riya@KiloRobotics.io", phone: "9812345678", country: "India" });
    await person(11, "acme-key", { company_id: 2, full_name: "Dev Rao", linkedin_url: "https://linkedin.com/in/devrao" });
    await person(12, "other-key", { full_name: "Other Person", email: "x@notacme.com" });

    expect(await runFor(ws, "acme-key", "companies")).toMatchObject({ read: 2, created: 2, failed: 0 });
    expect(await runFor(ws, "acme-key", "people")).toMatchObject({ read: 2, created: 2, failed: 0 });

    const kilo = await one(`select * from crm_companies where workspace_id = $1 and name = 'Kilo Robotics'`, [ws]);
    expect(kilo).toMatchObject({ domain: "kilorobotics.io", industry: "Robotics", location: "Pune", headcount: 120, source: "brain" });
    const riya = await contactOf("10");
    expect(riya).toMatchObject({
      first_name: "Riya", last_name: "Shah", job_title: "Head of Sales", email: "riya@kilorobotics.io",
      phone_e164: "+919812345678", company_id: kilo.id, lifecycle_stage: "prospect", source: "brain",
    });
    expect((await contactOf("11")).linkedin_url).toBe("https://linkedin.com/in/devrao");

    expect(await count(`select count(*) n from crm_companies where workspace_id = $1`, [ws])).toBe(2);
    expect(await count(`select count(*) n from crm_contacts where workspace_id = $1`, [ws])).toBe(2);
    expect(await count(`select count(*) n from crm_contacts where workspace_id = $1`, [other])).toBe(0);
  });

  it("a second run reads nothing new and duplicates nothing", async () => {
    expect(await runFor(ws, "acme-key", "companies")).toMatchObject({ read: 0 });
    expect(await runFor(ws, "acme-key", "people")).toMatchObject({ read: 0 });
    expect(await count(`select count(*) n from crm_contacts where workspace_id = $1`, [ws])).toBe(2);
    expect(await one(`select rows_read, rows_failed, last_id from crm_brain_feed_cursors where workspace_id = $1 and feed = 'people'`, [ws])).toEqual({
      rows_read: "2", rows_failed: "0", last_id: "11",
    });
  });

  it("a changed row is read again and only fills empty fields; what the team typed stays", async () => {
    await seed.query(`update crm_contacts set job_title = 'CEO (typed by Sam)' where id = $1`, [(await contactOf("10")).id]);
    await seed.query(
      `update brain_feed_people set job_title = 'VP Sales', location = 'Pune', updated_at = '2026-10-05T10:00:00Z' where id = 10`,
    );
    expect(await runFor(ws, "acme-key", "people")).toMatchObject({ read: 1, created: 0, updated: 1 });
    expect(await contactOf("10")).toMatchObject({ job_title: "CEO (typed by Sam)", location: "Pune" });
  });

  it("pages by (updated_at, id): rows sharing one timestamp are each taken exactly once", async () => {
    for (let i = 0; i < 5; i++) await company(100 + i, "acme-key", `Tie Co ${i}`, { website: `tie${i}.com` }, "2026-10-06T09:00:00.123456Z");
    const r = await runFor(ws, "acme-key", "companies", 2);
    expect(r).toMatchObject({ read: 5, created: 5 });
    expect(await count(`select count(*) n from crm_companies where workspace_id = $1 and name like 'Tie Co %'`, [ws])).toBe(5);
    expect(await runFor(ws, "acme-key", "companies", 2)).toMatchObject({ read: 0 });
  });

  it("a row the intake refuses is counted and logged, and the bookmark moves past it", async () => {
    await person(20, "acme-key", { full_name: "No Way To Reach" }, "2026-10-07T10:00:00Z");
    await person(21, "acme-key", { full_name: "Tara Nair", email: "tara@limafoods.in", company_id: 2 }, "2026-10-07T10:00:01Z");
    expect(await runFor(ws, "acme-key", "people")).toMatchObject({ read: 2, created: 1, failed: 1 });
    expect(await contactOf("21")).toMatchObject({ email: "tara@limafoods.in" });
    const cursor = await one(`select last_id, rows_failed, last_error from crm_brain_feed_cursors where workspace_id = $1 and feed = 'people'`, [ws]);
    expect(cursor.last_id).toBe("21");
    expect(cursor.rows_failed).toBe("1");
    expect(cursor.last_error).toMatch(/^20: /);
    expect(await runFor(ws, "acme-key", "people")).toMatchObject({ read: 0 });
  });

  it("runBrainFeed runs every taking-part workspace, companies before people, and logs what moved", async () => {
    await company(30, "other-key", "Other Co", { website: "otherco.com" }, "2026-10-08T10:00:00Z");
    await person(31, "other-key", { full_name: "Omar Ali", email: "omar@otherco.com", company_id: 30 }, "2026-10-08T10:00:00Z");
    const lines: string[] = [];
    await feed.runBrainFeed({ log: (m) => lines.push(m) });
    const omar = await one(
      `select c.company_id, co.name from crm_contacts c join crm_companies co on co.id = c.company_id
        where c.workspace_id = $1 and c.email = 'omar@otherco.com'`,
      [other],
    );
    expect(omar.name).toBe("Other Co");
    expect(lines.some((l) => l.startsWith("[brain-feed] other-key: companies 2 read"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[brain-feed] acme-key"))).toBe(false);
  });

  describe("calls", () => {
    it("interested: an AI call, a qualified deal in Meeting Scheduling owned by the default owner, one 'Schedule discovery meeting' task", async () => {
      const riya = await contactOf("10");
      const id = await call({ phone: "+91 98123 45678", outcome: "interested", summary: "Wants a demo next week." });
      expect(await runFor(ws, "acme-key", "calls")).toMatchObject({ read: 1, created: 1, failed: 0 });

      const c = await crmCall(id);
      expect(c).toMatchObject({ contact_id: riya.id, source: "ai", connected: true, ai_outcome: "interested", duration_seconds: 95 });
      const deal = await one(`select * from crm_deals where contact_id = $1 and outcome = 'open'`, [riya.id]);
      expect(deal).toMatchObject({ stage: "meeting_scheduling", owner_id: sam });
      expect(c.deal_id).toBe(deal.id);
      expect((await contactOf("10")).lifecycle_stage).toBe("qualified");
      expect(await openTasks("deal_id = $1", [deal.id])).toEqual([
        expect.objectContaining({ task_type: "schedule_meeting", title: "Schedule discovery meeting", owner_id: sam }),
      ]);
      expect(await count(`select count(*) n from crm_notifications where recipient_id = $1 and deal_id = $2`, [sam, deal.id])).toBe(1);
    });

    it("the same call read again (Quickhowl updated it) makes no second deal, task or notification", async () => {
      await seed.query(`update brain_feed_calls set summary = 'Wants a demo next week. Budget approved.', updated_at = '2026-10-09T11:00:00Z' where outcome = 'interested'`);
      expect(await runFor(ws, "acme-key", "calls")).toMatchObject({ read: 1, created: 0, failed: 0 });
      const riya = await contactOf("10");
      expect(await count(`select count(*) n from crm_deals where contact_id = $1`, [riya.id])).toBe(1);
      expect(await count(`select count(*) n from crm_tasks where contact_id = $1 and status = 'open'`, [riya.id])).toBe(1);
      expect(await count(`select count(*) n from crm_notifications where recipient_id = $1`, [sam])).toBe(1);
    });

    it("callback_requested: a call task on the contact for the default owner, next working day 10:00 IST, no deal, once", async () => {
      const tara = await contactOf("21");
      await call({ phone: "9876500001", email: "tara@limafoods.in", outcome: "callback_requested" }, "2026-10-09T12:00:00Z");
      expect(await runFor(ws, "acme-key", "calls")).toMatchObject({ read: 1, failed: 0 });
      const tasks = await openTasks("contact_id = $1", [tara.id]);
      expect(tasks).toEqual([expect.objectContaining({ task_type: "call", title: "Callback requested by lead", owner_id: sam, deal_id: null })]);
      const due = new Date(tasks[0].due_at);
      expect(due.getUTCHours() * 60 + due.getUTCMinutes()).toBe(4 * 60 + 30);
      expect([0, 6]).not.toContain(due.getUTCDay());
      expect(await count(`select count(*) n from crm_deals where contact_id = $1`, [tara.id])).toBe(0);

      await seed.query(`update brain_feed_calls set updated_at = '2026-10-09T13:00:00Z' where outcome = 'callback_requested'`);
      await runFor(ws, "acme-key", "calls");
      expect(await openTasks("contact_id = $1", [tara.id])).toHaveLength(1);
    });

    it("do_not_call puts the contact on Do Not Contact; wrong_number marks the phone", async () => {
      await call({ phone: "9000000101", name: "Asked Never", outcome: "do_not_call" }, "2026-10-09T14:00:00Z");
      await call({ phone: "9000000102", name: "Wrong Person", outcome: "wrong_number" }, "2026-10-09T14:00:01Z");
      expect(await runFor(ws, "acme-key", "calls")).toMatchObject({ read: 2, created: 2, failed: 0 });
      const never = await one(`select * from crm_contacts where workspace_id = $1 and phone_e164 = '+919000000101'`, [ws]);
      expect(never).toMatchObject({ status: "do_not_contact", first_name: "Asked", lifecycle_stage: "engaged" });
      const wrong = await one(`select id from crm_contacts where workspace_id = $1 and phone_e164 = '+919000000102'`, [ws]);
      expect(await one(`select status from crm_contact_channels where contact_id = $1 and channel = 'phone'`, [wrong.id])).toEqual({ status: "wrong_number" });
    });

    it("a call still in progress is passed over, and taken once Quickhowl finishes it; not_interested stays activity only", async () => {
      const id = await call({ phone: "9000000103", name: "Later Finished", outcome: "pending", status: "ringing", connected: false }, "2026-10-09T15:00:00Z");
      expect(await runFor(ws, "acme-key", "calls")).toMatchObject({ read: 1, skipped: 1, created: 0 });
      expect(await crmCall(id)).toBeUndefined();

      await seed.query(`update brain_feed_calls set status = 'completed', outcome = 'not_interested', connected = true, updated_at = '2026-10-09T15:05:00Z' where id = $1`, [id]);
      expect(await runFor(ws, "acme-key", "calls")).toMatchObject({ read: 1, created: 1, skipped: 0 });
      const c = await crmCall(id);
      expect(c.ai_outcome).toBe("not_interested");
      expect(await count(`select count(*) n from crm_deals where contact_id = $1`, [c.contact_id])).toBe(0);
      expect(await openTasks("contact_id = $1", [c.contact_id])).toEqual([]);
    });

    it("next working day 10:00 IST skips the weekend (calls)", () => {
      // Friday 2026-10-09 20:00 IST -> Monday 2026-10-12 10:00 IST (04:30 UTC).
      expect(feed.nextWorkingDayIst(new Date("2026-10-09T14:30:00Z"))).toBe("2026-10-12T04:30:00.000Z");
      // Monday 08:00 IST -> Tuesday.
      expect(feed.nextWorkingDayIst(new Date("2026-10-12T02:30:00Z"))).toBe("2026-10-13T04:30:00.000Z");
    });
  });

  describe("emails", () => {
    const CAMPAIGN = "10000000-0000-4000-8000-000000000001";
    const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const enrollment = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    async function sent(n: number, to: string, extra: { opened?: string; bounced?: string; bounceType?: string } = {}, at = "2026-10-10T09:00:00Z") {
      await seed.query(
        `insert into brain_feed_emails (id, customer, campaign_id, campaign_name, step, subject, to_email, enrollment_id, sent_at,
           opened_at, bounced_at, bounce_type, created_at, updated_at)
         values ($1, 'acme-key', $2, 'October outreach', 1, 'Quick question', $3, $4, $5, $6, $7, $8, $5, $5)`,
        [uuid(n), CAMPAIGN, to, enrollment(n), at, extra.opened ?? null, extra.bounced ?? null, extra.bounceType ?? null],
      );
    }
    async function outcome(n: number, enrollmentNo: number, kind: string, email: string, replyText: string | null = null, at = "2026-10-11T09:00:00Z") {
      await seed.query(
        `insert into brain_feed_email_outcomes (id, customer, campaign_id, enrollment_id, kind, occurred_at, email, reply_text, created_at, updated_at)
         values ($1, 'acme-key', $2, $3, $4, $5, $6, $7, $5, $5)`,
        [`40000000-0000-4000-8000-${String(n).padStart(12, "0")}`, CAMPAIGN, enrollment(enrollmentNo), kind, at, email, replyText],
      );
    }
    const activity = (n: number) => one(`select * from crm_email_activities where workspace_id = $1 and external_source = 'email_tool' and external_id = $2`, [ws, uuid(n)]);
    const contactByEmail = (email: string) => one(`select * from crm_contacts where workspace_id = $1 and lower(email) = $2`, [ws, email]);
    const emailChannel = async (email: string) =>
      (await one(`select ch.status from crm_contact_channels ch join crm_contacts c on c.id = ch.contact_id where c.workspace_id = $1 and lower(c.email) = $2 and ch.channel = 'email'`, [ws, email]))?.status;

    it("a sent campaign email is recorded on its contact (a new one becomes a prospect) and makes it contacted", async () => {
      await sent(1, "Neha@Redwood.in");
      expect(await runFor(ws, "acme-key", "emails")).toMatchObject({ read: 1, created: 1, failed: 0 });
      const neha = await contactByEmail("neha@redwood.in");
      expect(neha).toMatchObject({ lifecycle_stage: "contacted", source: "brain" });
      expect(await activity(1)).toMatchObject({ contact_id: neha.id, status: "sent", campaign_ref: CAMPAIGN, campaign_name: "October outreach", step: 1, subject: "Quick question" });
    });

    it("opens move the status but not the lifecycle; a hard bounce blocks the address, a soft one does not", async () => {
      await seed.query(`update brain_feed_emails set opened_at = '2026-10-10T10:00:00Z', updated_at = '2026-10-10T10:00:00Z' where id = $1`, [uuid(1)]);
      await sent(2, "gone@nowhere.in", { bounced: "2026-10-10T09:05:00Z", bounceType: "HARD" }, "2026-10-10T09:01:00Z");
      await sent(3, "full@inbox.in", { bounced: "2026-10-10T09:05:00Z", bounceType: "SOFT" }, "2026-10-10T09:02:00Z");
      expect(await runFor(ws, "acme-key", "emails")).toMatchObject({ read: 3, failed: 0 });
      expect((await activity(1)).status).toBe("opened");
      expect((await contactByEmail("neha@redwood.in")).lifecycle_stage).toBe("contacted");
      expect((await activity(2)).status).toBe("bounced");
      expect(await emailChannel("gone@nowhere.in")).toBe("permanent_bounce");
      expect((await activity(3)).status).toBe("sent");
      expect(await emailChannel("full@inbox.in")).toBeUndefined();
    });

    it("outcomes land on the email they answer: a reply (with its text) makes the contact engaged; unsubscribes and complaints block email", async () => {
      await sent(4, "quit@acme.in", {}, "2026-10-10T11:00:00Z");
      await sent(5, "angry@acme.in", {}, "2026-10-10T11:01:00Z");
      await runFor(ws, "acme-key", "emails");
      await outcome(1, 1, "REPLIED", "neha@redwood.in", "Yes, let's talk on Monday.");
      await outcome(2, 4, "UNSUBSCRIBED", "quit@acme.in", null, "2026-10-11T09:00:01Z");
      await outcome(3, 5, "COMPLAINT", "angry@acme.in", null, "2026-10-11T09:00:02Z");
      expect(await runFor(ws, "acme-key", "email_outcomes")).toMatchObject({ read: 3, failed: 0 });

      expect(await activity(1)).toMatchObject({ status: "replied", reply_text: "Yes, let's talk on Monday." });
      expect((await contactByEmail("neha@redwood.in")).lifecycle_stage).toBe("engaged");
      expect((await activity(4)).status).toBe("unsubscribed");
      expect(await emailChannel("quit@acme.in")).toBe("unsubscribed");
      expect(await emailChannel("angry@acme.in")).toBe("unsubscribed");
    });

    it("an outcome with no sent email of its enrollment gets its own row; nothing is read twice", async () => {
      await outcome(4, 99, "REPLIED", "neha@redwood.in", "Following up from my other address.", "2026-10-11T09:00:03Z");
      expect(await runFor(ws, "acme-key", "email_outcomes")).toMatchObject({ read: 1, created: 1, failed: 0 });
      const own = await one(`select status, reply_text from crm_email_activities where workspace_id = $1 and external_id = $2`, [ws, `enrollment:${enrollment(99)}`]);
      expect(own).toEqual({ status: "replied", reply_text: "Following up from my other address." });

      const before = await count(`select count(*) n from crm_email_activities where workspace_id = $1`, [ws]);
      expect(await runFor(ws, "acme-key", "emails")).toMatchObject({ read: 0 });
      expect(await runFor(ws, "acme-key", "email_outcomes")).toMatchObject({ read: 0 });
      expect(await count(`select count(*) n from crm_email_activities where workspace_id = $1`, [ws])).toBe(before);
    });
  });
});
