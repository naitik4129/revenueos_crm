/**
 * P4: workflows, enrollment, the executor and the worker tick on the PGlite test database.
 * Workflows are built through the HTTP routes; the worker is driven through automation-runner.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));

type Runner = typeof import("../../src/services/automation-runner.js");
type Automation = typeof import("../../src/services/automation.service.js");
type Db = typeof import("../../src/db.js");

describe("automation and worker (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let runner: Runner;
  let automation: Automation;
  let db: Db;
  let sam: string;
  let ws: string;
  let templateId: string;
  let n = 0;
  const logs: string[] = [];
  const opts = { batchSize: 50, dryRun: true, log: (m: string) => logs.push(m) };

  const api = (method: "get" | "post" | "patch" | "put", path: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${sam}`).set("X-Workspace-Id", ws);
    return body ? r.send(body) : r;
  };
  const one = async (sql: string, params: unknown[] = []) => (await seed.query(sql, params)).rows[0];

  /** Creates, publishes and activates a workflow. */
  async function workflow(trigger: string, steps: object[]) {
    const wf = (await api("post", "/workflows", { name: `W${++n}`, trigger })).body;
    const put = await api("put", `/workflows/${wf.id}/versions/1/steps`, {
      steps: steps.map((s, order) => ({ order, delayDays: 0, enabled: true, ...s })),
    });
    expect(put.status).toBe(200);
    expect((await api("post", `/workflows/${wf.id}/versions/1/publish`, {})).status).toBe(200);
    expect((await api("patch", `/workflows/${wf.id}`, { status: "active" })).status).toBe(200);
    return wf.id as string;
  }
  const newContact = async () =>
    (await api("post", "/contacts", { firstName: "Asha", lastName: "Rao", email: `asha${++n}@acme.com`, jobTitle: "Founder", companyId: await company() })).body.id as string;
  const company = async () => (await api("post", "/companies", { name: `Acme ${++n}`, website: `https://acme${n}.com` })).body.id as string;
  const newDeal = async () => {
    const contactId = await newContact();
    return { contactId, dealId: (await api("post", "/deals", { contactId })).body.id as string };
  };
  const runOf = (dealId: string) => one(`select id, status, cancel_reason from crm.workflow_runs where deal_id = $1 order by created_at desc limit 1`, [dealId]);
  const actionsOf = async (runId: string) =>
    (await seed.query(`select action_type, status, attempt_count, scheduled_for from crm.scheduled_actions where workflow_run_id = $1 order by created_at`, [runId])).rows;
  const claimAll = () => db.withTransaction((c) => automation.claimDueActionIds(c, 50));

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    db = await import("../../src/db.js");
    runner = await import("../../src/services/automation-runner.js");
    automation = await import("../../src/services/automation.service.js");

    sam = (await seed.query(`insert into auth.users (email) values ('sam@x.com') returning id`)).rows[0].id;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, 'Sam Seller', 'sam@x.com')`, [sam]);
    await seed.query(`insert into crm.profiles (id, role) values ($1, 'salesperson')`, [sam]);
    ws = (await seed.query(`insert into crm.workspaces (name, slug) values ('One', 'one') returning id`)).rows[0].id;
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $2)`, [ws, sam]);

    templateId = (
      await api("post", "/templates", {
        name: "Intro",
        channel: "email",
        subject: "Hi {{contact.firstName}}",
        body: "<p>{{contact.fullName}} ({{contact.jobTitle}}) at {{company.name}} - deal stage {{deal.stage}}, owner {{deal.ownerName}}</p>",
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await db?.pool.end();
    await seed?.end();
    await testDb?.stop();
  });

  it("serves the variable list and previews unsaved text against a deal or a contact", async () => {
    const vars = (await api("get", "/templates/variables")).body.data as { token: string; group: string }[];
    expect(new Set(vars.map((v) => v.group))).toEqual(new Set(["contact", "company", "deal", "meeting", "date"]));
    expect(vars.some((v) => v.token.startsWith("lead."))).toBe(false);

    const text = { subject: "Hi {{contact.firstName}}", body: "<p>{{company.name}} / {{deal.stage}} / {{meeting.date}} / {{contact.nickname}}</p>" };
    const { contactId, dealId } = await newDeal();
    const byDeal = (await api("post", "/templates/preview", { ...text, dealId })).body;
    expect(byDeal).toMatchObject({ subject: "Hi Asha", dealId, meeting: null });
    expect(byDeal.body).toMatch(/^<p>Acme \d+ \/ new \/ \{\{meeting\.date\}\} \/ \{\{contact\.nickname\}\}<\/p>$/);
    expect(byDeal.missing).toEqual([
      { token: "meeting.date", reason: "needs_meeting" },
      { token: "contact.nickname", reason: "unknown" },
    ]);
    // A contact with an open deal previews as that deal; one without keeps deal.* unfilled.
    expect((await api("post", "/templates/preview", { ...text, contactId })).body.dealId).toBe(dealId);
    const prospect = (await api("post", "/templates/preview", { ...text, contactId: await newContact() })).body;
    expect(prospect.dealId).toBeNull();
    expect(prospect.missing).toContainEqual({ token: "deal.stage", reason: "needs_deal" });

    expect((await api("post", "/templates/preview", { ...text, dealId, contactId })).status).toBe(400);
    expect((await api("post", "/templates/preview", { ...text, contactId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
  });

  it("pages runs and scheduled actions and searches them by contact or company name (P7h)", async () => {
    const id = await workflow("manual_enrollment", [{ action: "create_call_task", config: "Call", delayDays: 3 }]);
    const deals = [await newDeal(), await newDeal(), await newDeal()];
    for (const { dealId } of deals) expect((await api("post", "/runs", { dealId, workflowId: id })).status).toBe(201);
    const company = (await api("get", `/deals/${deals[1]!.dealId}`)).body.companyName as string;

    const runs = (await api("get", `/runs?workflowId=${id}&limit=2`)).body;
    expect(runs).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(runs.data).toHaveLength(2);
    const searched = (await api("get", `/runs?search=${encodeURIComponent(company)}`)).body;
    expect(searched.data.map((r: { dealId: string }) => r.dealId)).toEqual([deals[1]!.dealId]);

    const actions = (await api("get", `/scheduled-actions?search=${encodeURIComponent(company)}`)).body;
    expect(actions.total).toBe(1);
    expect(actions.data[0]).toMatchObject({ dealId: deals[1]!.dealId, companyName: company });
    expect((await api("get", "/scheduled-actions?limit=1&offset=1")).body).toMatchObject({ limit: 1, offset: 1 });
  });

  it("a published version's steps cannot be edited", async () => {
    const id = await workflow("manual_enrollment", [{ action: "create_call_task" }]);
    const res = await api("put", `/workflows/${id}/versions/1/steps`, { steps: [{ order: 0, delayDays: 0, action: "stop_workflow", enabled: true }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/only a Draft version/);
  });

  it("deal_created enrolls a new deal; a prospect (contact without a deal) never enrolls", async () => {
    await workflow("deal_created", [{ action: "send_email", templateId }]);
    const prospect = await newContact();
    expect(await one(`select count(*)::int n from crm.workflow_runs where contact_id = $1`, [prospect])).toEqual({ n: 0 });

    const { dealId } = await newDeal();
    expect(await runOf(dealId)).toMatchObject({ status: "running" });
    expect((await api("get", `/deals/${dealId}`)).body.automationMode).toBe("active");
  });

  it("the worker (dry run) runs every step to completion and renders contact/company/deal variables", async () => {
    await seed.query(`update crm.workflows set status = 'paused' where workspace_id = $1`, [ws]);
    const id = await workflow("manual_enrollment", [
      { action: "create_call_task", config: "Call after intro" },
      { action: "send_email", templateId },
      { action: "change_lead_stage", config: "connected_qualifying" },
    ]);
    const { dealId } = await newDeal();
    expect((await api("post", "/runs", { dealId, workflowId: id })).status).toBe(201);
    const names = { contactName: "Asha Rao", companyName: expect.stringMatching(/^Acme \d+$/) };
    expect((await api("get", `/runs?dealId=${dealId}`)).body.data[0]).toMatchObject(names);
    expect((await api("get", `/scheduled-actions?dealId=${dealId}`)).body.data[0]).toMatchObject(names);

    logs.length = 0;
    for (let i = 0; i < 5 && (await runner.runAutomationTick(opts)); i++);

    const run = await runOf(dealId);
    expect(run.status).toBe("completed");
    expect((await actionsOf(run.id)).map((a) => a.status)).toEqual(["completed", "completed", "completed"]);
    expect((await api("get", `/deals/${dealId}`)).body.stage).toBe("connected_qualifying");
    expect((await api("get", `/deals/${dealId}/tasks`)).body.data.map((t: { title: string }) => t.title)).toContain("Call after intro");
    expect(await one(`select title from crm.timeline_events where deal_id = $1 and event_kind = 'email'`, [dealId])).toEqual({ title: "Email Sent (dry run)" });

    const sent = logs.find((l) => l.includes("DRY RUN send_email"))!;
    expect(sent).toContain("Subject: Hi Asha");
    expect(sent).toMatch(/Asha Rao \(Founder\) at Acme \d+ - deal stage new, owner Sam Seller/);
  });

  describe("send steps and their templates (gap 18)", () => {
    const newTemplate = async (name: string) =>
      (await api("post", "/templates", { name, channel: "email", subject: "Hi", body: "<p>Hello {{contact.firstName}}</p>" })).body.id as string;
    const remove = (path: string) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${sam}`).set("X-Workspace-Id", ws);
    const notices = (dealId: string) =>
      seed.query(`select recipient_id, title, detail, kind from crm.notifications where deal_id = $1 order by recipient_id`, [dealId]).then((r) => r.rows);

    it("a draft saves a send step without a template; publishing refuses it until one is set", async () => {
      const wf = (await api("post", "/workflows", { name: "Draft only", trigger: "manual_enrollment" })).body;
      const steps: object[] = [
        { order: 0, delayDays: 0, enabled: true, action: "create_call_task", config: "Call" },
        { order: 1, delayDays: 2, enabled: true, action: "send_whatsapp" },
      ];
      expect((await api("put", `/workflows/${wf.id}/versions/1/steps`, { steps })).status).toBe(200);
      const refused = await api("post", `/workflows/${wf.id}/versions/1/publish`, {});
      expect(refused.status).toBe(400);
      expect(refused.body.error.message).toBe("Step 2 (send_whatsapp) requires a template.");

      const wa = (await api("post", "/templates", { name: "WA", channel: "whatsapp", body: "Hello" })).body.id as string;
      steps[1] = { ...steps[1], templateId: wa };
      expect((await api("put", `/workflows/${wf.id}/versions/1/steps`, { steps })).status).toBe(200);
      expect((await api("post", `/workflows/${wf.id}/versions/1/publish`, {})).status).toBe(200);
    });

    it("refuses deleting or switching off a template the live version uses, naming the workflow", async () => {
      const live = await newTemplate("Live intro");
      const id = await workflow("manual_enrollment", [{ action: "send_email", templateId: live }]);
      const name = (await one(`select name from crm.workflows where id = $1`, [id])).name as string;

      const del = await remove(`/templates/${live}`);
      expect(del.status).toBe(409);
      expect(del.body.error.message).toContain(`"${name}"`);
      const off = await api("patch", `/templates/${live}`, { active: false });
      expect(off.status).toBe(409);
      expect(off.body.error.message).toMatch(new RegExp(`^Cannot switch off this template: it is used by "${name}"`));
      expect((await api("patch", `/templates/${live}`, { active: true })).status).toBe(200);
    });

    it("also guards an older version that still has a run in progress; once the run ends it can be switched off", async () => {
      await seed.query(`update crm.workflows set status = 'paused' where workspace_id = $1`, [ws]);
      const old = await newTemplate("Old version email");
      const id = await workflow("manual_enrollment", [{ action: "send_email", templateId: old, delayDays: 3 }]);
      const { dealId } = await newDeal();
      expect((await api("post", "/runs", { dealId, workflowId: id })).status).toBe(201);
      const run = await runOf(dealId);
      expect(run.status).toBe("waiting");

      // V2 no longer uses the template, so only the waiting run on V1 still needs it.
      expect((await api("post", `/workflows/${id}/draft`, {})).status).toBeLessThan(300);
      const v2 = [{ order: 0, delayDays: 0, enabled: true, action: "create_call_task", config: "Call" }];
      expect((await api("put", `/workflows/${id}/versions/2/steps`, { steps: v2 })).status).toBe(200);
      expect((await api("post", `/workflows/${id}/versions/2/publish`, {})).status).toBe(200);
      expect((await api("patch", `/templates/${old}`, { active: false })).status).toBe(409);
      expect((await remove(`/templates/${old}`)).status).toBe(409);

      // Once the run ends it can be switched off; deleting stays refused (with a reason, not a 500)
      // because published steps never change, so V1 keeps the template in its history.
      expect((await api("post", `/runs/${run.id}/cancel`, {})).status).toBe(200);
      expect((await api("patch", `/templates/${old}`, { active: false })).status).toBe(200);
      const del = await remove(`/templates/${old}`);
      expect(del.status).toBe(409);
      expect(del.body.error.message).toMatch(/keep it in their history\. Switch it off instead\.$/);
    });

    it("a template used only by a draft can still be deleted", async () => {
      const draftOnly = await newTemplate("Draft only email");
      const wf = (await api("post", "/workflows", { name: "Draft user", trigger: "manual_enrollment" })).body;
      const steps = [{ order: 0, delayDays: 0, enabled: true, action: "send_email", templateId: draftOnly }];
      expect((await api("put", `/workflows/${wf.id}/versions/1/steps`, { steps })).status).toBe(200);
      expect((await remove(`/templates/${draftOnly}`)).status).toBeLessThan(300);
    });

    // The guards can still be bypassed (a race, or a direct DB edit): the worker skips and tells someone.
    it.each([
      // A published step's template can't be deleted (409, and the DB trigger), so "missing" means
      // bad or legacy data: the queued send points at a template id that doesn't exist.
      [
        "missing",
        "No template resolved for this step.",
        `update crm.scheduled_actions set payload = jsonb_set(payload, '{templateId}', '"00000000-0000-4000-8000-000000000000"')
          where payload->>'templateId' = $1::text`,
      ],
      ["inactive", "Template is inactive.", "update crm.message_templates set is_active = false where id = $1"],
    ])("worker: a %s template skips the send, the run carries on, and the owner is told", async (problem, reason, breakSql) => {
      await seed.query(`update crm.workflows set status = 'paused' where workspace_id = $1`, [ws]);
      const tpl = await newTemplate(`Skip ${problem}`);
      const id = await workflow("manual_enrollment", [
        { action: "send_email", templateId: tpl },
        { action: "create_call_task", config: "Follow up" },
      ]);
      const { dealId } = await newDeal();
      await seed.query(`update crm.deals set owner_id = $2 where id = $1`, [dealId, sam]);
      expect((await api("post", "/runs", { dealId, workflowId: id })).status).toBe(201);
      await seed.query(breakSql, [tpl]);

      for (let i = 0; i < 5 && (await runner.runAutomationTick(opts)); i++);
      const run = await runOf(dealId);
      expect(run.status).toBe("completed");
      expect((await actionsOf(run.id)).map((a) => [a.action_type, a.status])).toEqual([
        ["send_email", "skipped"],
        ["create_call_task", "completed"],
      ]);
      expect(await one(`select last_error from crm.scheduled_actions where workflow_run_id = $1 and action_type = 'send_email'`, [run.id])).toEqual({
        last_error: reason,
      });
      const name = (await one(`select name from crm.workflows where id = $1`, [id])).name as string;
      expect(await notices(dealId)).toEqual([
        {
          recipient_id: sam,
          title: `Workflow ${name} skipped a send: template ${problem}`,
          detail: expect.stringMatching(/^Step 1 was not sent to Asha Rao\. .* The run carried on\.$/),
          kind: "warning",
        },
      ]);
    });

    it("worker: an unowned deal's skip notice goes to every salesperson member, never to admins", async () => {
      await seed.query(`update crm.workflows set status = 'paused' where workspace_id = $1`, [ws]);
      const member = async (email: string, role: string) => {
        const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
        await seed.query(`insert into crm.profiles (id, role) values ($1, $2)`, [id, role]);
        await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $2)`, [ws, id]);
        return id;
      };
      const sue = await member("sue@x.com", "salesperson");
      await member("boss@x.com", "admin");
      const tpl = await newTemplate("Skip unowned");
      const id = await workflow("manual_enrollment", [{ action: "send_email", templateId: tpl }]);
      const { dealId } = await newDeal();
      await seed.query(`update crm.deals set owner_id = null where id = $1`, [dealId]);
      expect((await api("post", "/runs", { dealId, workflowId: id })).status).toBe(201);
      await seed.query(`update crm.message_templates set is_active = false where id = $1`, [tpl]);

      for (let i = 0; i < 5 && (await runner.runAutomationTick(opts)); i++);
      expect((await notices(dealId)).map((n) => n.recipient_id)).toEqual([sam, sue].sort());
    });
  });

  describe("eligibility is checked right before each action", () => {
    async function claimedEmail() {
      await seed.query(`update crm.workflows set status = 'paused' where workspace_id = $1`, [ws]);
      const id = await workflow("manual_enrollment", [{ action: "send_email", templateId }]);
      const deal = await newDeal();
      await api("post", "/runs", { dealId: deal.dealId, workflowId: id });
      const run = await runOf(deal.dealId);
      const actionId = (await one(`select id from crm.scheduled_actions where workflow_run_id = $1`, [run.id])).id as string;
      expect(await claimAll()).toContain(actionId);
      return { ...deal, runId: run.id as string, actionId };
    }

    it("DNC contact: the action is skipped and the run stopped", async () => {
      const { contactId, runId, actionId } = await claimedEmail();
      await api("post", `/contacts/${contactId}/dnc`, { reason: "Asked to stop" });
      await runner.processAction(actionId, opts);
      expect((await actionsOf(runId))[0].status).toBe("skipped");
      expect((await one(`select status from crm.workflow_runs where id = $1`, [runId])).status).toBe("cancelled");
    });

    it("closed deal: the action is skipped", async () => {
      const { dealId, runId, actionId } = await claimedEmail();
      await api("post", `/deals/${dealId}/won`);
      await runner.processAction(actionId, opts);
      expect((await actionsOf(runId))[0].status).toBe("skipped");
      expect((await one(`select status from crm.workflow_runs where id = $1`, [runId])).status).toBe("cancelled");
    });

    it("manual automation: the action is skipped and the run stopped by the check itself", async () => {
      const { dealId, runId, actionId } = await claimedEmail();
      await seed.query(`update crm.deals set automation_mode = 'manual' where id = $1`, [dealId]);
      await runner.processAction(actionId, opts);
      expect((await actionsOf(runId))[0].status).toBe("skipped");
      expect(await one(`select status, cancel_reason from crm.workflow_runs where id = $1`, [runId])).toEqual({ status: "cancelled", cancel_reason: 'Deal automation is "manual".' });
    });

    it("paused automation: the action is deferred (back to pending later, no retry used)", async () => {
      const { dealId, runId, actionId } = await claimedEmail();
      await seed.query(`update crm.deals set automation_mode = 'paused' where id = $1`, [dealId]);
      await runner.processAction(actionId, opts);
      const [action] = await actionsOf(runId);
      expect(action).toMatchObject({ status: "pending", attempt_count: 0 });
      expect(new Date(action.scheduled_for).getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
      expect((await one(`select status from crm.workflow_runs where id = $1`, [runId])).status).toBe("running");
    });

    it("unsubscribed email channel: the email is skipped but the run carries on", async () => {
      const { contactId, runId, actionId } = await claimedEmail();
      await api("post", `/contacts/${contactId}/contactability`, { channel: "email", status: "unsubscribed" });
      await runner.processAction(actionId, opts);
      expect((await actionsOf(runId))[0].status).toBe("skipped");
      expect((await one(`select status from crm.workflow_runs where id = $1`, [runId])).status).toBe("completed");
    });

    it("nurture deal: a workflow enrolled after parking still runs", async () => {
      await seed.query(`update crm.workflows set status = 'paused' where workspace_id = $1`, [ws]);
      const id = await workflow("meeting_not_a_fit", [{ action: "send_email", templateId }]);
      const { dealId } = await newDeal();
      await api("post", `/deals/${dealId}/nurture`);
      expect((await api("post", "/runs", { dealId, workflowId: id })).status).toBe(201);
      expect((await api("get", `/deals/${dealId}`)).body).toMatchObject({ outcome: "nurture", automationMode: "active" });

      await runner.runAutomationTick(opts);
      const run = await runOf(dealId);
      expect(run.status).toBe("completed");
      expect((await actionsOf(run.id))[0].status).toBe("completed");
    });
  });
});
