/**
 * P3: calls (with routing and the no-open-deal rule), tasks, meetings and proposals over HTTP
 * on the PGlite test database. Only Supabase Auth is mocked: a bearer token is the user's id.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));

describe("calls, tasks, meetings, proposals (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let appPool: Pool;
  let sam: string;
  let w1: string;
  let w2: string;
  let n = 0;

  const api = (method: "get" | "post" | "patch", path: string, body?: object, ws = w1) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${sam}`).set("X-Workspace-Id", ws);
    return body ? r.send(body) : r;
  };
  const newContact = async (ws = w1) => {
    const res = await api("post", "/contacts", { firstName: "C", email: `c${++n}@x.com` }, ws);
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const newDeal = async (ws = w1) => {
    const contactId = await newContact(ws);
    const res = await api("post", "/deals", { contactId }, ws);
    expect(res.status).toBe(201);
    return { contactId, dealId: res.body.id as string };
  };
  const deal = async (id: string) => (await api("get", `/deals/${id}`)).body;
  const openTasks = async (dealId: string) =>
    (await api("get", `/deals/${dealId}/tasks`)).body.data.filter((t: { status: string }) => t.status === "open") as { type: string; title: string; dueAt: string }[];
  const logCall = (contactId: string, body: object) => api("post", `/contacts/${contactId}/calls`, body);
  const later = () => new Date(Date.now() + 2 * 86_400_000).toISOString();

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    appPool = (await import("../../src/db.js")).pool;

    sam = (await seed.query(`insert into auth.users (email) values ('sam@x.com') returning id`)).rows[0].id;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, 'Sam', 'sam@x.com')`, [sam]);
    await seed.query(`insert into crm.profiles (id, role) values ($1, 'salesperson')`, [sam]);
    w1 = (await seed.query(`insert into crm.workspaces (name, slug) values ('One', 'one') returning id`)).rows[0].id;
    w2 = (await seed.query(`insert into crm.workspaces (name, slug) values ('Two', 'two') returning id`)).rows[0].id;
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $3), ($2, $3)`, [w1, w2, sam]);
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await seed?.end();
    await testDb?.stop();
  });

  it("a new deal gets a 'First call' task as its next action", async () => {
    const { dealId } = await newDeal();
    const tasks = await openTasks(dealId);
    expect(tasks).toEqual([expect.objectContaining({ type: "call", title: "First call" })]);
    expect((await deal(dealId)).nextAction).toMatchObject({ type: "call", title: "First call" });
  });

  describe("call outcomes route the open deal (CONTEXT.md, call routing)", () => {
    const cases: [string, object, Record<string, unknown>, string, string | undefined][] = [
      // [name, call body, expected deal fields, new task type, workflow trigger]
      ["not connected", { connected: false, notConnectedReason: "no_answer" }, { stage: "not_connected_nurture", automationMode: "active" }, "call", "call_not_connected"],
      ["positive", { connected: true, connectedOutcome: "positive" }, { stage: "meeting_scheduling", automationMode: "manual" }, "schedule_meeting", undefined],
      ["meeting agreed", { connected: true, connectedOutcome: "meeting_agreed" }, { stage: "meeting_scheduling", automationMode: "active" }, "schedule_meeting", "meeting_agreed"],
      ["interested later", { connected: true, connectedOutcome: "interested_later", interestedLater: { reason: "Budget in Q2", restartAt: "2027-04-01" } }, { stage: "interested_later", automationMode: "active", interestedLaterReason: "Budget in Q2", interestedLaterRestartAt: "2027-04-01" }, "follow_up", "call_outcome_interested_later"],
      ["future possibility", { connected: true, connectedOutcome: "future_possibility" }, { stage: "future_possibility", automationMode: "active" }, "follow_up", "call_outcome_future_possibility"],
      ["information requested", { connected: true, connectedOutcome: "information_requested" }, { stage: "connected_qualifying", automationMode: "active" }, "follow_up", "call_outcome_information_requested"],
      ["callback requested", { connected: true, connectedOutcome: "callback_requested", callbackDueAt: "LATER" }, { stage: "new", automationMode: "manual" }, "call", undefined],
      ["budget objection", { connected: true, connectedOutcome: "budget_price" }, { stage: "objection_nurture", objectionType: "budget_price", automationMode: "active" }, "follow_up", "objection_budget_price"],
      ["internal approval", { connected: true, connectedOutcome: "internal_approval" }, { stage: "objection_nurture", objectionType: "internal_approval" }, "general_task", "objection_internal_approval"],
      ["wrong fit", { connected: true, connectedOutcome: "wrong_fit" }, { stage: "new", objectionType: "wrong_fit", automationMode: "manual" }, "general_task", undefined],
      ["wrong person", { connected: true, connectedOutcome: "wrong_person" }, { stage: "connected_qualifying" }, "general_task", undefined],
    ];

    it.each(cases)("%s", async (_name, body, expected, taskType, trigger) => {
      const { contactId, dealId } = await newDeal();
      const callbackDueAt = later();
      const res = await logCall(contactId, JSON.parse(JSON.stringify(body).replace('"LATER"', JSON.stringify(callbackDueAt))));
      expect(res.status).toBe(201);
      expect(res.body.deal).toMatchObject({ id: dealId, ...expected });
      expect(res.body.workflowTrigger).toBe(trigger);
      expect(res.body.call).toMatchObject({ source: "human", dealId, salespersonName: "Sam" });
      expect((await openTasks(dealId)).map((t) => t.type)).toContain(taskType);
      if (taskType === "call" && "callbackDueAt" in body) {
        expect((await openTasks(dealId)).find((t) => t.title === "Callback requested by lead")?.dueAt).toBe(callbackDueAt);
      }
    });

    it("invalid number records phone contactability and still routes the deal", async () => {
      const { contactId, dealId } = await newDeal();
      await logCall(contactId, { connected: false, notConnectedReason: "invalid_number" });
      expect((await deal(dealId)).stage).toBe("not_connected_nurture");
      expect((await api("get", `/contacts/${contactId}/contactability`)).body.data).toEqual([expect.objectContaining({ channel: "phone", status: "invalid" })]);
    });

    it("a positive call cancels stale follow-ups and logging against a call task completes it", async () => {
      const { contactId, dealId } = await newDeal();
      const firstCall = (await api("get", `/deals/${dealId}/tasks`)).body.data[0].id;
      await api("post", "/tasks", { dealId, type: "follow_up", title: "Old follow-up", dueAt: later() });
      await logCall(contactId, { connected: true, connectedOutcome: "positive", taskId: firstCall });
      const all = (await api("get", `/deals/${dealId}/tasks`)).body.data as { title: string; status: string }[];
      expect(all.find((t) => t.title === "First call")?.status).toBe("completed");
      expect(all.find((t) => t.title === "Old follow-up")?.status).toBe("cancelled");
    });
  });

  describe("the no-open-deal rule", () => {
    it("a pipeline outcome on a contact without a deal creates one (no First call task) and qualifies the contact", async () => {
      const contactId = await newContact();
      const res = await logCall(contactId, { connected: true, connectedOutcome: "positive" });
      expect(res.body.deal).toMatchObject({ contactId, outcome: "open", stage: "meeting_scheduling" });
      expect(res.body.contact.lifecycleStage).toBe("qualified");
      expect((await openTasks(res.body.deal.id)).map((t) => t.title)).toEqual(["Schedule discovery meeting"]);
    });

    it("reopens the contact's parked (nurture) deal instead of creating a new one", async () => {
      const { contactId, dealId } = await newDeal();
      await api("post", `/deals/${dealId}/nurture`);
      const res = await logCall(contactId, { connected: true, connectedOutcome: "information_requested" });
      expect(res.body.deal).toMatchObject({ id: dealId, outcome: "open", stage: "connected_qualifying" });
      expect((await api("get", `/contacts/${contactId}/deals`)).body.total).toBe(1);
    });

    it.each([
      ["do not contact", { connected: true, connectedOutcome: "do_not_contact", notes: "Remove me" }],
      ["wrong number", { connected: false, notConnectedReason: "wrong_number" }],
      ["wrong person", { connected: true, connectedOutcome: "wrong_person" }],
      ["no answer", { connected: false, notConnectedReason: "no_answer" }],
    ])("%s never creates a deal", async (_name, body) => {
      const contactId = await newContact();
      const res = await logCall(contactId, body);
      expect(res.status).toBe(201);
      expect(res.body.deal).toBeNull();
      expect((await api("get", `/contacts/${contactId}/deals`)).body.total).toBe(0);
    });

    it("contact-level outcomes keep their effects without a deal: DNC, phone status, a contact task", async () => {
      const dnc = await newContact();
      expect((await logCall(dnc, { connected: true, connectedOutcome: "do_not_contact" })).body.contact).toMatchObject({ status: "do_not_contact" });
      expect((await logCall(dnc, { connected: false, notConnectedReason: "busy" })).status).toBe(409);

      const wrong = await newContact();
      await logCall(wrong, { connected: false, notConnectedReason: "wrong_number" });
      expect((await api("get", `/contacts/${wrong}/contactability`)).body.data[0]).toMatchObject({ channel: "phone", status: "wrong_number" });
      const tasks = (await api("get", `/contacts/${wrong}/tasks`)).body.data;
      expect(tasks).toEqual([expect.objectContaining({ type: "call", contactId: wrong })]);
      expect(tasks[0].dealId).toBeUndefined();
    });

    it("human calls advance the lifecycle: not connected -> contacted, connected -> engaged", async () => {
      const contactId = await newContact();
      expect((await logCall(contactId, { connected: false, notConnectedReason: "busy" })).body.contact.lifecycleStage).toBe("contacted");
      expect((await logCall(contactId, { connected: true, connectedOutcome: "callback_requested", callbackDueAt: later() })).body.contact.lifecycleStage).toBe("engaged");
    });
  });

  it("lists a contact's human and AI calls and its email activity", async () => {
    const contactId = await newContact();
    await logCall(contactId, { connected: false, notConnectedReason: "busy" });
    await seed.query(
      `insert into crm.calls (workspace_id, contact_id, source, connected, ai_outcome, transcript, occurred_at)
       values ($1, $2, 'ai', true, 'interested', 'Hello...', now() - interval '1 day')`,
      [w1, contactId],
    );
    await seed.query(
      `insert into crm.email_activities (workspace_id, contact_id, campaign_name, step, status, sent_at, replied_at, reply_text)
       values ($1, $2, 'Launch', 1, 'replied', now() - interval '2 days', now(), 'Sounds good')`,
      [w1, contactId],
    );
    const calls = (await api("get", `/contacts/${contactId}/calls`)).body.data;
    expect(calls.map((c: { source: string }) => c.source)).toEqual(["human", "ai"]);
    expect(calls[1]).toMatchObject({ aiOutcome: "interested", transcript: "Hello..." });
    expect((await api("get", `/contacts/${contactId}/email-activities`)).body.data).toEqual([
      expect.objectContaining({ campaignName: "Launch", step: 1, status: "replied", replyText: "Sounds good" }),
    ]);
  });

  describe("meetings", () => {
    const book = async (dealId: string) => {
      const res = await api("post", "/meetings", { dealId, title: "Discovery", at: later(), participants: [{ email: "p@x.com" }] });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    it("booking moves the deal to meeting_scheduled, replaces call tasks with a prep task", async () => {
      const { dealId } = await newDeal();
      await book(dealId);
      expect((await deal(dealId)).stage).toBe("meeting_scheduled");
      expect((await openTasks(dealId)).map((t) => t.type)).toEqual(["confirm_meeting"]);
    });

    const outcomes: [string, Record<string, unknown>, string | undefined][] = [
      ["highly_interested", { stage: "proposal_preparation", outcome: "open" }, "general_task"],
      ["proposal_required", { stage: "proposal_preparation", outcome: "open" }, "prepare_proposal"],
      ["needs_internal_discussion", { stage: "objection_nurture", objectionType: "internal_approval" }, "general_task"],
      ["needs_more_information", { stage: "meeting_follow_up" }, "send_case_study"],
      ["follow_up_required", { stage: "meeting_follow_up" }, "follow_up"],
      ["second_meeting", { stage: "meeting_scheduling" }, "schedule_meeting"],
      ["not_interested", { outcome: "nurture", stage: "meeting_scheduled" }, "re_engage"],
      ["won", { outcome: "won", lifecycleStage: "customer" }, undefined],
    ];

    it.each(outcomes)("outcome %s routes the deal", async (outcome, expected, taskType) => {
      const { dealId } = await newDeal();
      const meetingId = await book(dealId);
      const res = await api("post", `/meetings/${meetingId}/outcome`, { outcome });
      expect(res.body).toMatchObject({ status: "completed", outcome });
      expect(await deal(dealId)).toMatchObject(expected);
      const types = (await openTasks(dealId)).map((t) => t.type);
      if (taskType) expect(types).toContain(taskType);
      else expect(types).toEqual([]);
    });

    it("cannot book a meeting on a closed deal", async () => {
      const { dealId } = await newDeal();
      await api("post", `/deals/${dealId}/won`);
      expect((await api("post", "/meetings", { dealId, title: "Late", at: later() })).status).toBe(409);
    });
  });

  describe("proposals", () => {
    const draft = async () => {
      const { dealId } = await newDeal();
      const res = await api("post", "/proposals", { dealId, title: "Retainer", amount: 50000 });
      expect(res.status).toBe(201);
      expect((await deal(dealId)).stage).toBe("proposal_preparation");
      return { dealId, proposalId: res.body.id as string };
    };

    it("sent -> decision pending with a follow-up task", async () => {
      const { dealId, proposalId } = await draft();
      const res = await api("post", `/proposals/${proposalId}/status`, { status: "sent" });
      expect(res.body.sentDate).toBeTruthy();
      expect((await deal(dealId)).stage).toBe("proposal_decision_pending");
      expect((await openTasks(dealId)).map((t) => t.type)).toContain("proposal_follow_up");
    });

    it("accepted -> deal won, open tasks cancelled, and the status is then terminal", async () => {
      const { dealId, proposalId } = await draft();
      await api("post", `/proposals/${proposalId}/status`, { status: "sent" });
      await api("post", `/proposals/${proposalId}/status`, { status: "accepted" });
      expect(await deal(dealId)).toMatchObject({ outcome: "won", lifecycleStage: "customer" });
      expect(await openTasks(dealId)).toEqual([]);
      expect((await api("post", `/proposals/${proposalId}/status`, { status: "revised" })).status).toBe(409);
    });

    it("rejected requires a loss reason, then parks the deal with a re-engage task", async () => {
      const { dealId, proposalId } = await draft();
      await api("post", `/proposals/${proposalId}/status`, { status: "sent" });
      const missing = await api("post", `/proposals/${proposalId}/status`, { status: "rejected" });
      expect(missing.status).toBe(400);
      expect(missing.body.error.message).toMatch(/lossReason is required/);

      const res = await api("post", `/proposals/${proposalId}/status`, { status: "rejected", lossReason: "price_budget", lossNotes: "Too expensive" });
      expect(res.body).toMatchObject({ status: "rejected", lossReason: "price_budget", lossNotes: "Too expensive" });
      expect((await deal(dealId)).outcome).toBe("nurture");
      const types = (await openTasks(dealId)).map((t) => t.type);
      expect(types).toContain("re_engage");
      expect(types).not.toContain("proposal_follow_up");
    });
  });

  it("lists carry the contact and company names, and task tabs filter on the server", async () => {
    const companyId = (await api("post", "/companies", { name: "Acme Ltd" })).body.id as string;
    const contactId = (await api("post", "/contacts", { firstName: "Ada", lastName: "Lane", email: `ada${++n}@x.com`, companyId })).body.id as string;
    const dealId = (await api("post", "/deals", { contactId })).body.id as string;
    await api("post", "/meetings", { dealId, title: "Intro", at: later() });
    await api("post", "/proposals", { dealId, title: "Quote" });
    const loner = (await api("post", "/contacts", { firstName: "Solo", email: `solo${++n}@x.com` })).body.id as string;
    await api("post", "/tasks", { contactId: loner, type: "follow_up", title: "Callback", dueAt: later() });

    const names = { contactName: "Ada Lane", companyName: "Acme Ltd" };
    const mine = (rows: { dealId?: string }[]) => rows.filter((r) => r.dealId === dealId);
    expect(mine((await api("get", "/tasks?limit=1000")).body.data)[0]).toMatchObject(names);
    expect(mine((await api("get", "/meetings")).body.data)[0]).toMatchObject(names);
    expect(mine((await api("get", "/proposals")).body.data)[0]).toMatchObject(names);
    const [solo] = (await api("get", `/tasks?contactId=${loner}`)).body.data;
    expect(solo).toMatchObject({ contactName: "Solo" });
    expect(solo).not.toHaveProperty("companyName");

    const upcoming = (await api("get", `/tasks?contactId=${loner}&upcomingOnly=true`)).body;
    expect(upcoming.total).toBe(1);
    expect((await api("get", `/tasks?contactId=${loner}&dueTodayOnly=true`)).body.total).toBe(0);
    expect((await api("get", `/tasks?contactId=${loner}&overdueOnly=true`)).body.total).toBe(0);
  });

  describe("server paging (P7h)", () => {
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

    it("splits meetings into upcoming (soonest first), past (latest first) and today", async () => {
      const book = async (at: string) => {
        const { dealId } = await newDeal();
        return (await api("post", "/meetings", { dealId, title: "M", at })).body.id as string;
      };
      const past = await book(new Date(Date.now() - 3 * 86_400_000).toISOString());
      const now = await book(new Date().toISOString());
      const soon = await book(later());

      const upcoming = (await api("get", "/meetings?when=upcoming&limit=500")).body;
      const pastList = (await api("get", "/meetings?when=past&limit=500")).body;
      const today = (await api("get", "/meetings?when=today&limit=500")).body;
      expect(ids(upcoming.data)).toEqual(expect.arrayContaining([now, soon]));
      expect(ids(upcoming.data)).not.toContain(past);
      expect(ids(pastList.data)).toContain(past);
      expect(ids(today.data)).toContain(now);
      expect(ids(today.data)).not.toContain(soon);
      const ats = (rows: { at: string }[]) => rows.map((r) => r.at);
      expect(ats(upcoming.data)).toEqual([...ats(upcoming.data)].sort());
      expect(ats(pastList.data)).toEqual([...ats(pastList.data)].sort().reverse());

      const page = (await api("get", "/meetings?when=upcoming&limit=2&offset=1")).body;
      expect(page).toMatchObject({ total: upcoming.total, limit: 2, offset: 1 });
      expect(ids(page.data)).toEqual(ids(upcoming.data).slice(1, 3));
      expect((await api("get", "/meetings")).body.limit).toBe(50);
    });

    it("pages proposals, summarises the whole workspace, and keeps the deal route unpaged", async () => {
      const { dealId } = await newDeal();
      for (const [title, amount] of [["A", 100], ["B", 250], ["C", 400]] as const) {
        expect((await api("post", "/proposals", { dealId, title, amount })).status).toBe(201);
      }
      const all = (await api("get", "/proposals?limit=500")).body;
      expect(all.total).toBe(all.data.length);
      const page = (await api("get", `/proposals?dealId=${dealId}&limit=1&offset=1`)).body;
      expect(page).toMatchObject({ total: 3, limit: 1, offset: 1 });
      expect(page.data).toHaveLength(1);

      const dealList = (await api("get", `/deals/${dealId}/proposals`)).body;
      expect(dealList.data).toHaveLength(3);
      expect(dealList.total).toBeUndefined();

      type P = { status: string; amount?: number };
      const rows = all.data as P[];
      expect((await api("get", "/proposals/summary")).body).toEqual({
        open: rows.filter((p) => !["accepted", "rejected", "withdrawn", "expired"].includes(p.status)).length,
        awaitingDecision: rows.filter((p) => p.status === "sent").length,
        valueInPlay: rows
          .filter((p) => ["sent", "revision_requested", "revised"].includes(p.status))
          .reduce((sum, p) => sum + (p.amount ?? 0), 0),
      });
    });
  });

  it("isolates workspaces on the new routes: another workspace's ids give 404", async () => {
    const { contactId, dealId } = await newDeal(w2);
    const taskId = (await api("get", `/deals/${dealId}/tasks`, undefined, w2)).body.data[0].id;
    const meetingId = (await api("post", "/meetings", { dealId, title: "M", at: later() }, w2)).body.id;
    const proposalId = (await api("post", "/proposals", { dealId, title: "P" }, w2)).body.id;

    const responses = [
      await logCall(contactId, { connected: false, notConnectedReason: "busy" }),
      await api("get", `/contacts/${contactId}/calls`),
      await api("get", `/contacts/${contactId}/email-activities`),
      await api("get", `/contacts/${contactId}/tasks`),
      await api("get", `/deals/${dealId}/tasks`),
      await api("get", `/deals/${dealId}/meetings`),
      await api("get", `/deals/${dealId}/proposals`),
      await api("post", `/tasks/${taskId}/complete`),
      await api("post", "/tasks", { dealId, type: "call", title: "X", dueAt: later() }),
      await api("post", "/meetings", { dealId, title: "M", at: later() }),
      await api("post", `/meetings/${meetingId}/outcome`, { outcome: "won" }),
      await api("post", "/proposals", { dealId, title: "P" }),
      await api("post", `/proposals/${proposalId}/status`, { status: "sent" }),
    ];
    expect(responses.map((r) => r.status)).toEqual(Array(responses.length).fill(404));
    expect((await api("get", "/tasks")).body.data.every((t: { dealId?: string }) => t.dealId !== dealId)).toBe(true);
  });
});
