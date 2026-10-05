/**
 * Website-form lead intake against a REAL Postgres database with every
 * Supabase migration applied. Skipped unless TEST_DATABASE_URL is set (same
 * convention as businessFlows.test.ts). Use a scratch database only - these
 * tests commit rows. Every email/phone is random per run so reruns never
 * collide with earlier data.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { Actor } from "../../src/authMiddleware.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

describeIfDb("website lead ingest (requires TEST_DATABASE_URL)", () => {
  let pool: Pool;
  let actor: Actor;

  async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function ingest(form: Record<string, string>, workspaceId = WORKSPACE_ID) {
    const { ingestWebsiteLead } = await import("../../src/services/leadIngest.service.js");
    return inTransaction((client) => ingestWebsiteLead(client, workspaceId, form));
  }

  const uniqueEmail = () => `ingest-${randomUUID()}@example.com`;
  const uniquePhone = () => `+9198${Math.floor(10000000 + Math.random() * 89999999)}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const auth = await pool.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`ingest-rep-${randomUUID()}@example.com`]);
    const profile = await pool.query(`select id, full_name, email from public.profiles where id = $1`, [auth.rows[0].id]);
    actor = { id: profile.rows[0].id, fullName: profile.rows[0].full_name, email: profile.rows[0].email, isActive: true, role: "salesperson" };
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates an unassigned website lead with events, a first-call task and notifications - and starts no automation", async () => {
    const email = uniqueEmail();
    const outcome = await ingest({
      name: "Test User",
      email: email.toUpperCase(),
      phone: uniquePhone(),
      company: "Test Pvt Ltd",
      message: "Testing the form\nIndustry: Industrial Automation\nRevenue range: Rs.10–50Cr",
    });
    expect(outcome.status).toBe("created");
    const leadId = (outcome as { leadId: string }).leadId;

    const lead = (await pool.query(`select * from public.leads where id = $1`, [leadId])).rows[0];
    expect(lead).toMatchObject({
      workspace_id: WORKSPACE_ID,
      first_name: "Test",
      last_name: "User",
      company: "Test Pvt Ltd",
      industry: "Industrial Automation",
      email,
      source: "website",
      owner_id: null,
      created_by: null,
      created_by_name: "Website form",
      pipeline_stage: "new",
      lifecycle_state: "active",
    });
    expect(lead.phone_e164).toMatch(/^\+91/);

    const titles = (await pool.query(`select title, detail, actor_source from public.timeline_events where lead_id = $1`, [leadId])).rows;
    expect(titles.map((t) => t.title)).toEqual(expect.arrayContaining(["Lead Created", "Website form submission", "Task Created"]));
    const submission = titles.find((t) => t.title === "Website form submission");
    expect(submission.detail).toContain("Revenue range: Rs.10–50Cr");
    expect(submission.detail).toContain("Message: Testing the form");

    const tasks = (await pool.query(`select title, owner_id, status, task_type from public.tasks where lead_id = $1`, [leadId])).rows;
    expect(tasks).toEqual([{ title: "First call", owner_id: null, status: "open", task_type: "call" }]);

    const notifications = await pool.query(`select 1 from public.notifications where lead_id = $1 and recipient_id = $2`, [leadId, actor.id]);
    expect(notifications.rowCount).toBe(1);

    const runs = await pool.query(`select 1 from public.workflow_runs where lead_id = $1`, [leadId]);
    expect(runs.rowCount).toBe(0);
  });

  it("uses the company placeholder and splits a single-word name", async () => {
    const outcome = await ingest({ name: "naitik", email: uniqueEmail(), phone: "", company: "", message: "" });
    expect(outcome.status).toBe("created");
    const lead = (await pool.query(`select first_name, last_name, company from public.leads where id = $1`, [(outcome as { leadId: string }).leadId])).rows[0];
    expect(lead).toEqual({ first_name: "Naitik", last_name: "", company: "Not provided" });
  });

  it("still creates the lead when the phone is junk but the email is valid", async () => {
    const outcome = await ingest({ name: "Pat Doe", email: uniqueEmail(), phone: "abc", company: "X Co", message: "hello" });
    expect(outcome.status).toBe("created");
    const id = (outcome as { leadId: string }).leadId;
    const lead = (await pool.query(`select phone, phone_e164 from public.leads where id = $1`, [id])).rows[0];
    expect(lead).toEqual({ phone: null, phone_e164: null });
    const submission = (await pool.query(`select detail from public.timeline_events where lead_id = $1 and title = 'Website form submission'`, [id])).rows[0];
    expect(submission.detail).toContain("abc");
  });

  it("rejects a submission with neither a valid email nor a valid phone and writes nothing", async () => {
    const marker = `nothing-${randomUUID()}`;
    const outcome = await ingest({ name: marker, email: "nope", phone: "123", company: "Z", message: "" });
    expect(outcome.status).toBe("rejected");
    const rows = await pool.query(`select 1 from public.leads where first_name = $1`, [marker]);
    expect(rows.rowCount).toBe(0);
  });

  it("matches an existing lead by email (case-insensitive) or phone instead of creating a second one", async () => {
    const email = uniqueEmail();
    const phone = uniquePhone();
    const first = await ingest({ name: "Dup Person", email, phone, company: "Dup Co", message: "first" });
    expect(first.status).toBe("created");
    const id = (first as { leadId: string }).leadId;

    const byEmail = await ingest({ name: "Dup Person", email: email.toUpperCase(), phone: "", company: "Dup Co", message: "second" });
    expect(byEmail).toEqual({ status: "duplicate", leadId: id });

    const byPhone = await ingest({ name: "Dup Person", email: uniqueEmail(), phone, company: "Dup Co", message: "third" });
    expect(byPhone).toEqual({ status: "duplicate", leadId: id });

    const leads = await pool.query(`select 1 from public.leads where workspace_id = $1 and (lower(email) = $2 or phone_e164 = $3)`, [WORKSPACE_ID, email, phone]);
    expect(leads.rowCount).toBe(1);

    const again = await pool.query(`select 1 from public.timeline_events where lead_id = $1 and title = 'Website form submitted again'`, [id]);
    expect(again.rowCount).toBe(2);
  });

  it("absorbs an identical resubmission (double click / retry) without a new event or notification", async () => {
    const email = uniqueEmail();
    const form = { name: "Twice Clicker", email, phone: "", company: "T Co", message: "same message" };
    const first = await ingest(form);
    const id = (first as { leadId: string }).leadId;
    const second = await ingest(form);
    expect(second).toEqual({ status: "duplicate", leadId: id });

    const events = await pool.query(`select title from public.timeline_events where lead_id = $1 and title like 'Website form%'`, [id]);
    expect(events.rows.map((r) => r.title)).toEqual(["Website form submission"]);
    const notifications = await pool.query(`select 1 from public.notifications where lead_id = $1 and recipient_id = $2`, [id, actor.id]);
    expect(notifications.rowCount).toBe(1);
  });

  it("never changes the state of a Do Not Contact lead when its owner resubmits the form", async () => {
    const { markDnc } = await import("../../src/services/leads.service.js");
    const email = uniqueEmail();
    const first = await ingest({ name: "Dnc Person", email, phone: "", company: "D Co", message: "hi" });
    const id = (first as { leadId: string }).leadId;
    await inTransaction((client) => markDnc(client, actor, WORKSPACE_ID, id, { reason: "asked to stop" }));

    const again = await ingest({ name: "Dnc Person", email, phone: "", company: "D Co", message: "hello again" });
    expect(again).toEqual({ status: "duplicate", leadId: id });

    const lead = (await pool.query(`select lifecycle_state, automation_mode from public.leads where id = $1`, [id])).rows[0];
    expect(lead).toEqual({ lifecycle_state: "do_not_contact", automation_mode: "stopped" });
    const note = await pool.query(`select detail from public.notifications where lead_id = $1 and title = 'Website form submitted again'`, [id]);
    expect(note.rows[0].detail).toContain("do_not_contact");
  });

  it("creates only one lead when the same person submits twice at the same instant", async () => {
    const email = uniqueEmail();
    const results = await Promise.all([
      ingest({ name: "Race Runner", email, phone: "", company: "R Co", message: "a" }),
      ingest({ name: "Race Runner", email, phone: "", company: "R Co", message: "b" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["created", "duplicate"]);
    const leads = await pool.query(`select 1 from public.leads where lower(email) = $1`, [email]);
    expect(leads.rowCount).toBe(1);
  });

  it("keeps workspaces isolated: the same email in another workspace is a separate lead", async () => {
    const otherWorkspace = randomUUID();
    await pool.query(`insert into public.workspaces (id, name, slug) values ($1, $2, $3)`, [otherWorkspace, `ingest-test-${otherWorkspace}`, `ingest-test-${otherWorkspace}`]);
    const email = uniqueEmail();
    const a = await ingest({ name: "Iso Lated", email, phone: "", company: "I Co", message: "x" });
    const b = await ingest({ name: "Iso Lated", email, phone: "", company: "I Co", message: "x" }, otherWorkspace);
    expect(a.status).toBe("created");
    expect(b.status).toBe("created");
    expect((a as { leadId: string }).leadId).not.toBe((b as { leadId: string }).leadId);
  });
});
