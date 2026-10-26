/**
 * Schema checks for Supabase/migrations/011_crm_brain_intake.sql on the PGlite test database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

describe("crm brain intake schema (PGlite)", () => {
  let testDb: TestDb;
  let pool: Pool;

  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query(sql, params)).rows[0] as T;
  const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;
  const contact = (ws: string, extra: Record<string, string> = {}) => {
    const cols = ["workspace_id", "first_name", ...Object.keys(extra)];
    const vals = [ws, "Pat", ...Object.values(extra)];
    return id(
      `insert into crm_contacts (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      vals,
    );
  };

  let w1: string;
  let w2: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    pool = new Pool({ connectionString: testDb.url, max: 2 });
    w1 = await id(`insert into crm_workspaces (name, slug) values ('A', 'a') returning id`);
    w2 = await id(`insert into crm_workspaces (name, slug) values ('B', 'b') returning id`);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await testDb?.stop();
  });

  it("adds the 3 tables with RLS, crm_app access and no Data API access", async () => {
    const p = await one(
      `select bool_and(has_table_privilege('crm_app', 'public.crm_' || t, 'insert')) crm_app,
              bool_or(has_table_privilege('anon', 'public.crm_' || t, 'select')) anon,
              bool_or(has_table_privilege('authenticated', 'public.crm_' || t, 'select')) authed,
              bool_and(c.relrowsecurity) rls
         from unnest(array['external_refs', 'email_activities', 'brain_api_keys']) t
         join pg_class c on c.oid = ('public.crm_' || t)::regclass`,
    );
    expect(p).toEqual({ crm_app: true, anon: false, authed: false, rls: true });
  });

  it("updates the enums: brain source, deal_created trigger, ordered lifecycle and email status", async () => {
    const labels = async (type: string) =>
      (await pool.query(`select unnest(enum_range(null::${type}))::text v`)).rows.map((r) => r.v);
    expect(await labels("crm_lead_source")).toContain("brain");
    const triggers = await labels("crm_workflow_trigger");
    expect(triggers).toContain("deal_created");
    expect(triggers).not.toContain("lead_created");
    expect(await labels("crm_lifecycle_stage")).toEqual(["prospect", "contacted", "engaged", "qualified", "customer"]);
    expect(await labels("crm_email_status")).toEqual(["sent", "delivered", "opened", "replied", "bounced", "unsubscribed"]);
  });

  it("creates contacts as prospects, accepts LinkedIn-only, and only moves forward with <", async () => {
    const c = await contact(w1, { linkedin_url: "https://linkedin.com/in/pat" });
    expect(await one(`select lifecycle_stage from crm_contacts where id = $1`, [c])).toEqual({ lifecycle_stage: "prospect" });
    await expect(pool.query(`insert into crm_contacts (workspace_id, first_name) values ($1, 'Nobody')`, [w1])).rejects.toThrow(
      /crm_contacts_has_identifier/,
    );

    const advance = `update crm_contacts set lifecycle_stage = $2, lifecycle_changed_at = now()
                      where id = $1 and lifecycle_stage < $2::crm_lifecycle_stage`;
    expect((await pool.query(advance, [c, "engaged"])).rowCount).toBe(1);
    expect((await pool.query(advance, [c, "contacted"])).rowCount).toBe(0);
    expect(await one(`select lifecycle_stage from crm_contacts where id = $1`, [c])).toEqual({ lifecycle_stage: "engaged" });
  });

  it("maps external ids per source and entity, in one workspace, and drops them with the entity", async () => {
    const c = await contact(w1, { email: "ref@x.com" });
    const co = await id(`insert into crm_companies (workspace_id, name, headcount) values ($1, 'Acme', 40) returning id`, [w1]);
    const ref = `insert into crm_external_refs (workspace_id, company_id, contact_id, source, external_id) values ($1, $2, $3, $4, $5)`;

    await pool.query(ref, [w1, null, c, "quickicp", "101"]);
    await pool.query(ref, [w1, null, c, "quickhowl", "101"]); // same id, other tool
    await pool.query(ref, [w1, co, null, "quickicp", "101"]); // same id, company not contact
    await expect(pool.query(ref, [w1, null, c, "quickicp", "101"])).rejects.toThrow(/crm_external_refs_contact_key/);
    await expect(pool.query(ref, [w1, co, c, "quickicp", "102"])).rejects.toThrow(/crm_external_refs_exactly_one_entity/);
    await expect(pool.query(ref, [w1, null, c, "hubspot", "103"])).rejects.toThrow(/crm_external_refs_source_valid/);
    await expect(pool.query(ref, [w2, null, c, "quickicp", "104"])).rejects.toThrow(/crm_external_refs_contact_fk/);

    await pool.query(`delete from crm_contacts where id = $1`, [c]);
    expect(await one(`select count(*)::int n from crm_external_refs where workspace_id = $1`, [w1])).toEqual({ n: 1 });
  });

  it("stores AI calls without the human outcome rule, which still applies to human calls", async () => {
    const c = await contact(w1, { phone: "+919800000001" });
    const ai = await id(
      `insert into crm_calls (workspace_id, contact_id, source, connected, ai_outcome, duration_seconds, transcript, recording_url, external_source, external_id)
       values ($1, $2, 'ai', true, 'interested', 95, 'Hello...', 'https://rec/1', 'quickhowl', 'call-1') returning id`,
      [w1, c],
    );
    expect(ai).toBeTruthy();
    await expect(
      pool.query(`insert into crm_calls (workspace_id, contact_id, connected) values ($1, $2, true)`, [w1, c]),
    ).rejects.toThrow(/crm_calls_outcome_matches_connection/);
    await expect(
      pool.query(
        `insert into crm_calls (workspace_id, contact_id, source, connected, external_source, external_id) values ($1, $2, 'ai', false, 'quickhowl', 'call-1')`,
        [w1, c],
      ),
    ).rejects.toThrow(/crm_calls_workspace_external_key/);
  });

  it("keeps one email activity per external id and stamps updated_at", async () => {
    const c = await contact(w1, { email: "mail@x.com" });
    const insert = `insert into crm_email_activities (workspace_id, contact_id, external_source, external_id, campaign_ref, step, sent_at)
                    values ($1, $2, 'email_tool', 'enr-1:1', 'camp-1', 1, now()) returning id, updated_at`;
    const row = await one<{ id: string; updated_at: Date }>(insert, [w1, c]);
    await expect(pool.query(insert, [w1, c])).rejects.toThrow(/crm_email_activities_workspace_external_key/);
    await expect(
      pool.query(`insert into crm_email_activities (workspace_id, contact_id, external_source) values ($1, $2, 'email_tool')`, [w1, c]),
    ).rejects.toThrow(/crm_email_activities_external_pair/);

    await new Promise((r) => setTimeout(r, 5));
    const updated = await one<{ status: string; updated_at: Date }>(
      `update crm_email_activities set status = 'replied', replied_at = now(), reply_text = 'Yes' where id = $1 returning status, updated_at`,
      [row.id],
    );
    expect(updated.status).toBe("replied");
    expect(updated.updated_at.getTime()).toBeGreaterThan(row.updated_at.getTime());
  });

  it("stores brain keys by unique hash and clears a deleted default owner", async () => {
    const key = `insert into crm_brain_api_keys (workspace_id, key_hash, key_prefix, label) values ($1, 'hash-1', 'nbk_ab12', 'brain')`;
    await pool.query(key, [w1]);
    await expect(pool.query(key, [w2])).rejects.toThrow(/brain_api_keys_key_hash_key/);

    const u = await id(`insert into auth.users default values returning id`);
    await pool.query(`insert into crm_profiles (id) values ($1)`, [u]);
    await pool.query(`update crm_workspaces set default_owner_id = $1 where id = $2`, [u, w1]);
    await pool.query(`delete from auth.users where id = $1`, [u]);
    expect(await one(`select default_owner_id from crm_workspaces where id = $1`, [w1])).toEqual({ default_owner_id: null });
  });
});
