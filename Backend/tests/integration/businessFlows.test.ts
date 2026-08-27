/**
 * End-to-end business-flow tests against a REAL Postgres database running
 * the Supabase migration (Supabase/migrations/001_initial_migration.sql).
 *
 * These are skipped automatically unless TEST_DATABASE_URL is set, so
 * `npm test` stays green in any environment without a live database (e.g.
 * this sandbox, or a fresh clone before `supabase start`/a project exists).
 * To actually run them:
 *   1. Point a Postgres instance at the migration (a local `supabase start`
 *      stack, or a scratch Supabase project).
 *   2. TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres npm run test:integration
 *
 * Auth is bypassed here (these exercise the service layer directly, not
 * HTTP) — authMiddleware itself is exercised by the manual smoke test in
 * the implementation report, since it requires a real Supabase Auth user.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Actor } from "../../src/authMiddleware.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("business flows (requires TEST_DATABASE_URL)", () => {
  let pool: Pool;
  let actor: Actor;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const auth = await pool.query(
      `insert into auth.users (id, email) values (gen_random_uuid(), 'test-salesperson@example.com') returning id`,
    );
    const userId = auth.rows[0].id as string;
    const profile = await pool.query(
      `select id, full_name, email from public.profiles where id = $1`,
      [userId],
    );
    actor = { id: profile.rows[0].id, fullName: profile.rows[0].full_name, email: profile.rows[0].email, isActive: true };
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Scenario 1 — create lead: ownership, initial state, activity", async () => {
    const { withTransaction } = await import("../../src/db.js");
    const { createLead } = await import("../../src/services/leads.service.js");
    const { listTimelineForLead } = await import("../../src/services/timeline.service.js");

    const lead = await withTransaction((client) =>
      createLead(client, actor, { firstName: "Ada", company: "Analytics Co", source: "website", email: "ada@example.com" }),
    );

    expect(lead.pipeline_stage).toBe("new");
    expect(lead.lifecycle_state).toBe("active");
    expect(lead.automation_mode).toBe("manual");
    expect(lead.owner_id).toBe(actor.id);

    const timeline = await listTimelineForLead(pool, lead.id);
    expect(timeline.some((e) => e.title === "Lead Created")).toBe(true);
    expect(timeline.some((e) => e.title === "Lead Assigned")).toBe(true);
  });

  it("Scenario 2 — call not connected: stage, task, nurture enrollment", async () => {
    const { withTransaction } = await import("../../src/db.js");
    const { createLead } = await import("../../src/services/leads.service.js");
    const { logCall } = await import("../../src/services/calls.service.js");
    const { listTasks } = await import("../../src/services/tasks.service.js");

    const lead = await withTransaction((client) =>
      createLead(client, actor, { firstName: "Ben", company: "Beta Ltd", source: "referral", phone: "+15550000000" }),
    );

    const result = await withTransaction((client) => logCall(client, actor, lead.id, { connected: false, notConnectedReason: "no_answer" }));

    expect(result.lead.pipeline_stage).toBe("not_connected_nurture");
    expect(result.lead.automation_mode).toBe("active");

    const tasks = await listTasks(pool, { leadId: lead.id });
    expect(tasks.some((t) => t.type === "call" && t.status === "open")).toBe(true);
  });

  it("Scenario 5 — DNC stops automation and clears next action", async () => {
    const { withTransaction } = await import("../../src/db.js");
    const { createLead, markDnc } = await import("../../src/services/leads.service.js");
    const { logCall } = await import("../../src/services/calls.service.js");
    const { listTasks } = await import("../../src/services/tasks.service.js");

    const lead = await withTransaction((client) =>
      createLead(client, actor, { firstName: "Cara", company: "Gamma Inc", source: "cold_call", email: "cara@example.com" }),
    );
    await withTransaction((client) => logCall(client, actor, lead.id, { connected: false, notConnectedReason: "busy" }));

    const dncLead = await withTransaction((client) => markDnc(client, actor, lead.id, { reason: "Requested no contact" }));
    expect(dncLead.lifecycle_state).toBe("do_not_contact");
    expect(dncLead.automation_mode).toBe("stopped");

    const tasks = await listTasks(pool, { leadId: lead.id, status: "open" });
    expect(tasks.length).toBe(0);
  });
});
