/**
 * Schema-level checks for Supabase/migrations 000-010 on the PGlite test database:
 * grants, RLS, uniqueness, cross-workspace FKs and the 009 triggers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

describe("crm schema (PGlite)", () => {
  let testDb: TestDb;
  let pool: Pool;

  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query(sql, params)).rows[0] as T;
  const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;

  let w1: string;
  let w2: string;
  let c1: string;
  let d1: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    pool = new Pool({ connectionString: testDb.url, max: 2 });
    w1 = await id(`insert into crm.workspaces (name, slug) values ('A', 'a') returning id`);
    w2 = await id(`insert into crm.workspaces (name, slug) values ('B', 'b') returning id`);
    c1 = await id(`insert into crm.contacts (workspace_id, first_name, email) values ($1, 'Ann', 'ann@x.com') returning id`, [w1]);
    d1 = await id(`insert into crm.deals (workspace_id, contact_id, automation_mode) values ($1, $2, 'active') returning id`, [w1, c1]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await testDb?.stop();
  });

  it("has 35 tables, all with RLS, writable by crm_app only", async () => {
    const t = await one<{ n: number; rls: number }>(
      `select count(*)::int n, count(*) filter (where rowsecurity)::int rls from pg_tables where schemaname = 'crm'`,
    );
    expect(t).toEqual({ n: 35, rls: 35 });
    const p = await one(
      `select has_table_privilege('crm_app', 'crm.deals', 'insert') crm_app,
              has_table_privilege('anon', 'crm.deals', 'select') anon,
              has_table_privilege('authenticated', 'crm.deals', 'select') authed,
              has_table_privilege('crm_app', 'public.revenueos_profiles', 'select') profiles`,
    );
    expect(p).toEqual({ crm_app: true, anon: false, authed: false, profiles: true });
  });

  it("enforces case-insensitive email, one open deal per contact, and same-workspace links", async () => {
    await expect(
      pool.query(`insert into crm.contacts (workspace_id, first_name, email) values ($1, 'Dup', 'ANN@x.com')`, [w1]),
    ).rejects.toThrow(/contacts_workspace_email_key/);
    await expect(pool.query(`insert into crm.deals (workspace_id, contact_id) values ($1, $2)`, [w1, c1])).rejects.toThrow(
      /deals_one_open_per_contact/,
    );
    await expect(pool.query(`insert into crm.deals (workspace_id, contact_id) values ($1, $2)`, [w2, c1])).rejects.toThrow(
      /deals_contact_fk/,
    );
  });

  it("requires a task's contact to match its deal's contact", async () => {
    const c2 = await id(`insert into crm.contacts (workspace_id, first_name, email) values ($1, 'Bob', 'bob@x.com') returning id`, [w1]);
    const insertTask = `insert into crm.tasks (workspace_id, deal_id, contact_id, task_type, title, due_at)
                        values ($1, $2, $3, 'call', 'Call', now()) returning id`;
    await expect(pool.query(insertTask, [w1, d1, c2])).rejects.toThrow(/must equal its deal/);
    const t = await id(insertTask, [w1, d1, c1]);
    await expect(pool.query(`update crm.tasks set contact_id = $1 where id = $2`, [c2, t])).rejects.toThrow(/must equal its deal/);
  });

  it("cascades outcome changes, DNC and won to runs, automation and tasks", async () => {
    const wf = await id(`insert into crm.workflows (workspace_id, name, trigger) values ($1, 'W', 'manual_enrollment') returning id`, [w1]);
    const v = await id(`insert into crm.workflow_versions (workspace_id, workflow_id, version_number) values ($1, $2, 1) returning id`, [w1, wf]);
    const st = await id(
      `insert into crm.workflow_steps (workspace_id, workflow_version_id, step_order, action) values ($1, $2, 0, 'create_call_task') returning id`,
      [w1, v],
    );
    await pool.query(`update crm.workflow_versions set status = 'published', published_at = now() where id = $1`, [v]);
    await expect(pool.query(`update crm.workflow_steps set delay_days = 1 where id = $1`, [st])).rejects.toThrow(/only be modified while/);

    const enroll = async (deal: string) => {
      const run = await id(
        `insert into crm.workflow_runs (workspace_id, workflow_id, workflow_version_id, deal_id, contact_id) values ($1, $2, $3, $4, $5) returning id`,
        [w1, wf, v, deal, c1],
      );
      await pool.query(
        `insert into crm.scheduled_actions (workspace_id, deal_id, workflow_run_id, workflow_step_id, action_type, scheduled_for)
         values ($1, $2, $3, $4, 'create_call_task', now())`,
        [w1, deal, run, st],
      );
      return run;
    };
    const runStatus = async (run: string) => (await one<{ status: string }>(`select status from crm.workflow_runs where id = $1`, [run])).status;
    const dealRow = async (deal: string) => one(`select outcome, automation_mode from crm.deals where id = $1`, [deal]);

    // open -> nurture: old runs cancelled, automation may stay active.
    let run = await enroll(d1);
    await pool.query(`update crm.deals set outcome = 'nurture' where id = $1`, [d1]);
    expect(await runStatus(run)).toBe("cancelled");
    expect(await dealRow(d1)).toEqual({ outcome: "nurture", automation_mode: "active" });

    // Reopen is blocked while another deal is open.
    const d2 = await id(`insert into crm.deals (workspace_id, contact_id, automation_mode) values ($1, $2, 'active') returning id`, [w1, c1]);
    await expect(pool.query(`update crm.deals set outcome = 'open' where id = $1`, [d1])).rejects.toThrow(/deals_one_open_per_contact/);

    // DNC: deal stays open, automation stopped and kept stopped, history written.
    run = await enroll(d2);
    await pool.query(`update crm.contacts set status = 'do_not_contact', dnc_reason = 'asked' where id = $1`, [c1]);
    expect(await dealRow(d2)).toEqual({ outcome: "open", automation_mode: "stopped" });
    expect(await runStatus(run)).toBe("cancelled");
    await pool.query(`update crm.deals set automation_mode = 'active' where id = $1`, [d2]);
    expect(await dealRow(d2)).toEqual({ outcome: "open", automation_mode: "stopped" });
    await expect(
      pool.query(`update crm.contacts set status = 'active', dnc_reason = null where id = $1`, [c1]),
    ).rejects.toThrow(/requires dnc_reason/);
    await pool.query(`update crm.contacts set status = 'active', dnc_reason = 'called back' where id = $1`, [c1]);
    expect(await one(`select count(*)::int n from crm.dnc_events where contact_id = $1`, [c1])).toEqual({ n: 2 });

    // won: open tasks cancelled, automation stopped.
    const task = await id(
      `insert into crm.tasks (workspace_id, deal_id, task_type, title, due_at) values ($1, $2, 'call', 'Call', now()) returning id`,
      [w1, d2],
    );
    await pool.query(`update crm.deals set automation_mode = 'active' where id = $1`, [d2]);
    await pool.query(`update crm.deals set outcome = 'won' where id = $1`, [d2]);
    expect(await one(`select status from crm.tasks where id = $1`, [task])).toEqual({ status: "cancelled" });
    expect(await dealRow(d2)).toEqual({ outcome: "won", automation_mode: "stopped" });
  });

  it("keeps admin audit append-only but lets the actor's profile be deleted", async () => {
    const u = await id(`insert into auth.users default values returning id`);
    await pool.query(`insert into crm.profiles (id, role) values ($1, 'admin')`, [u]);
    await pool.query(`insert into crm.admin_audit_events (actor_id, actor_email, action, target_type) values ($1, 'a@x.com', 'x', 'user')`, [u]);
    await expect(pool.query(`delete from crm.admin_audit_events`)).rejects.toThrow(/append-only/);
    await pool.query(`delete from auth.users where id = $1`, [u]);
    expect(await one(`select actor_id from crm.admin_audit_events`)).toEqual({ actor_id: null });
  });
});
