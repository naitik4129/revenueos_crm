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
import { Pool, type PoolClient } from "pg";
import type { Actor } from "../../src/authMiddleware.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("business flows (requires TEST_DATABASE_URL)", () => {
  let pool: Pool;
  let actor: Actor;

  async function withTestTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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
    const { createLead } = await import("../../src/services/leads.service.js");
    const { listTimelineForLead } = await import("../../src/services/timeline.service.js");

    const lead = await withTestTransaction((client) =>
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
    const { createLead } = await import("../../src/services/leads.service.js");
    const { logCall } = await import("../../src/services/calls.service.js");
    const { listTasks } = await import("../../src/services/tasks.service.js");

    const lead = await withTestTransaction((client) =>
      createLead(client, actor, { firstName: "Ben", company: "Beta Ltd", source: "referral", phone: "+15550000000" }),
    );

    const result = await withTestTransaction((client) => logCall(client, actor, lead.id, { connected: false, notConnectedReason: "no_answer" }));

    expect(result.lead.pipeline_stage).toBe("not_connected_nurture");
    expect(result.lead.automation_mode).toBe("active");

    const tasks = await listTasks(pool, { leadId: lead.id });
    expect(tasks.some((t) => t.type === "call" && t.status === "open")).toBe(true);
  });

  it("Scenario 5 — DNC stops automation and clears next action", async () => {
    const { createLead, markDnc } = await import("../../src/services/leads.service.js");
    const { logCall } = await import("../../src/services/calls.service.js");
    const { listTasks } = await import("../../src/services/tasks.service.js");

    const lead = await withTestTransaction((client) =>
      createLead(client, actor, { firstName: "Cara", company: "Gamma Inc", source: "cold_call", email: "cara@example.com" }),
    );
    await withTestTransaction((client) => logCall(client, actor, lead.id, { connected: false, notConnectedReason: "busy" }));

    const dncLead = await withTestTransaction((client) => markDnc(client, actor, lead.id, { reason: "Requested no contact" }));
    expect(dncLead.lifecycle_state).toBe("do_not_contact");
    expect(dncLead.automation_mode).toBe("stopped");

    const tasks = await listTasks(pool, { leadId: lead.id, status: "open" });
    expect(tasks.length).toBe(0);
  });

  it("persists manual communication and supports open-task rescheduling and cancellation", async () => {
    const { createLead, logManualCommunication } = await import("../../src/services/leads.service.js");
    const { createTask, updateTask, cancelTask } = await import("../../src/services/tasks.service.js");
    const { listTimelineForLead } = await import("../../src/services/timeline.service.js");
    const lead = await withTestTransaction((client) =>
      createLead(client, actor, { firstName: "Dev", company: "Delta Co", source: "email", email: "dev@example.com" }),
    );
    const task = await withTestTransaction((client) =>
      createTask(client, actor, { leadId: lead.id, ownerId: actor.id, type: "call", title: "Initial call", dueAt: "2030-01-01T04:30:00.000Z" }),
    );

    const updated = await withTestTransaction((client) =>
      updateTask(client, actor, task.id, { title: "Rescheduled call", dueAt: "2030-01-02T04:30:00.000Z" }),
    );
    expect(updated.title).toBe("Rescheduled call");
    expect(updated.dueAt).toBe("2030-01-02T04:30:00.000Z");

    await withTestTransaction((client) => logManualCommunication(client, actor, lead.id, { channel: "email", detail: "Shared the requested overview" }));
    const cancelled = await withTestTransaction((client) => cancelTask(client, actor, task.id, "Replaced by meeting"));
    expect(cancelled.status).toBe("cancelled");

    const timeline = await listTimelineForLead(pool, lead.id);
    expect(timeline.some((event) => event.title === "Task Updated")).toBe(true);
    expect(timeline.some((event) => event.title === "Email Sent")).toBe(true);
  });

  it("routes meeting and proposal outcomes and includes them in dashboard aggregation", async () => {
    const { createLead, getLeadRowOr404 } = await import("../../src/services/leads.service.js");
    const { scheduleMeeting, recordMeetingOutcome } = await import("../../src/services/meetings.service.js");
    const { createProposal, updateProposalStatus } = await import("../../src/services/proposals.service.js");
    const { getDashboardSummary } = await import("../../src/services/dashboard.service.js");
    const lead = await withTestTransaction((client) =>
      createLead(client, actor, { firstName: "Esha", company: "Epsilon Co", source: "event", email: "esha@example.com" }),
    );
    const meeting = await withTestTransaction((client) =>
      scheduleMeeting(client, actor, { leadId: lead.id, title: "Discovery", at: "2030-01-03T04:30:00.000Z", durationMin: 30 }),
    );
    await withTestTransaction((client) => recordMeetingOutcome(client, actor, meeting.id, "proposal_required", "Prepare pricing"));
    const proposal = await withTestTransaction((client) =>
      createProposal(client, actor, { leadId: lead.id, title: "Epsilon proposal", amount: 125000 }),
    );
    await withTestTransaction((client) => updateProposalStatus(client, actor, proposal.id, "sent"));

    const routedLead = await getLeadRowOr404(pool, lead.id);
    expect(routedLead.pipeline_stage).toBe("proposal_sent");
    const summary = await getDashboardSummary(pool);
    expect(summary.activeLeads).toBeGreaterThan(0);
    expect(summary.proposalFollowUps).toBeGreaterThan(0);
  });

  it("keeps published workflow versions immutable while drafts remain editable", async () => {
    const { createWorkflow, updateDraftSteps, publishVersion, createDraft } = await import("../../src/services/workflows.service.js");
    const workflow = await withTestTransaction((client) =>
      createWorkflow(client, actor, { name: "Integration workflow", trigger: "manual_enrollment" }),
    );
    await withTestTransaction((client) =>
      updateDraftSteps(client, workflow.id, 1, [{ order: 0, delayDays: 0, action: "create_call_task", config: "Call lead", enabled: true }]),
    );
    await withTestTransaction((client) => publishVersion(client, actor, workflow.id, 1, "keep_existing"));

    await expect(
      withTestTransaction((client) =>
        updateDraftSteps(client, workflow.id, 1, [{ order: 0, delayDays: 1, action: "create_call_task", config: "Changed", enabled: true }]),
      ),
    ).rejects.toMatchObject({ code: "invalid_transition" });

    const withDraft = await withTestTransaction((client) => createDraft(client, actor, workflow.id));
    expect(withDraft.versions.some((version) => version.status === "draft" && version.version === 2)).toBe(true);
    expect(withDraft.versions.some((version) => version.status === "published" && version.version === 1)).toBe(true);
  });

  it("enrollLeadInWorkflow enrolls a lead in a chosen workflow regardless of its trigger", async () => {
    const { createLead } = await import("../../src/services/leads.service.js");
    const { createWorkflow, updateDraftSteps, publishVersion } = await import("../../src/services/workflows.service.js");
    const { enrollLeadInWorkflow } = await import("../../src/services/runs.service.js");

    const lead = await withTestTransaction((client) =>
      createLead(client, actor, { firstName: "Farah", company: "Foxtrot Co", source: "website", email: "farah@example.com" }),
    );
    // Trigger is call_not_connected, NOT manual_enrollment — autoEnroll(..., "manual_enrollment", ...)
    // would never find this workflow; enrollLeadInWorkflow must still enroll into it by id.
    const workflow = await withTestTransaction((client) =>
      createWorkflow(client, actor, { name: "Not Connected Nurture (integration)", trigger: "call_not_connected" }),
    );
    await withTestTransaction((client) =>
      updateDraftSteps(client, workflow.id, 1, [{ order: 0, delayDays: 0, action: "create_call_task", config: "Follow up", enabled: true }]),
    );
    await withTestTransaction((client) => publishVersion(client, actor, workflow.id, 1, "keep_existing"));

    const run = await withTestTransaction((client) => enrollLeadInWorkflow(client, lead.id, workflow.id, "Manually enrolled (test)"));
    expect(run).not.toBeNull();
    expect(run?.workflowId).toBe(workflow.id);
    expect(run?.status).toBe("running");

    // Re-enrolling while the run is still active is a no-op (no duplicate enrollment), not an error.
    const duplicate = await withTestTransaction((client) => enrollLeadInWorkflow(client, lead.id, workflow.id, "Second attempt"));
    expect(duplicate).toBeNull();
  });
});
