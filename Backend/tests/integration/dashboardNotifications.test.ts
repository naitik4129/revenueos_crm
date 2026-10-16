/**
 * P6: dashboard numbers and notifications on the PGlite test database. Brain data goes in
 * through /brain/v1; user requests mock Supabase Auth (a bearer token is the user's id).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));

const TODAY = `(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;

describe("dashboard and notifications (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let appPool: Pool;
  let admin: string;
  let sam: string;
  let w1: string;
  let w2: string;
  let key: string;
  let n = 0;

  async function mkUser(email: string, role: "admin" | "salesperson") {
    const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $3)`, [id, email.split("@")[0], email]);
    await seed.query(`insert into crm.profiles (id, role) values ($1, $2)`, [id, role]);
    return id;
  }
  const api = (method: "get" | "post", path: string, body?: object, ws = w1, as = sam) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${as}`).set("X-Workspace-Id", ws);
    return body ? r.send(body) : r;
  };
  const brain = async (path: string, items: object[]) => {
    const res = await request(app).post(`/api/v1/brain/v1${path}`).set("Authorization", `Bearer ${key}`).send({ items });
    expect(res.body.results.map((r: { status: string }) => r.status)).not.toContain("error");
  };
  const newDeal = async (ws = w1) => {
    const contact = await api("post", "/contacts", { firstName: "C", email: `c${++n}@x.com` }, ws);
    const deal = await api("post", "/deals", { contactId: contact.body.id }, ws);
    expect(deal.status).toBe(201);
    return { contactId: contact.body.id as string, dealId: deal.body.id as string };
  };
  const summary = async (ws = w1) => {
    const res = await api("get", "/dashboard/summary", undefined, ws);
    expect(res.status).toBe(200);
    return res.body;
  };
  const nonZero = (rows: { stage: string; count: number }[]) => Object.fromEntries(rows.filter((r) => r.count > 0).map((r) => [r.stage, r.count]));

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    appPool = (await import("../../src/db.js")).pool;

    admin = await mkUser("admin@x.com", "admin");
    sam = await mkUser("sam@x.com", "salesperson");
    w1 = (await seed.query(`insert into crm.workspaces (name, slug) values ('One', 'one') returning id`)).rows[0].id;
    w2 = (await seed.query(`insert into crm.workspaces (name, slug) values ('Two', 'two') returning id`)).rows[0].id;
    // The admin is a member of w1 too, so "notify all members" would reach them if admins were not excluded.
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $3), ($2, $3), ($1, $4)`, [w1, w2, sam, admin]);
    key = (await request(app).post(`/api/v1/workspaces/${w1}/brain-keys`).set("Authorization", `Bearer ${admin}`).send({ label: "brain" })).body.key;
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await seed?.end();
    await testDb?.stop();
  });

  describe("dashboard", () => {
    it("counts a seeded workspace (brain prospect, AI call, campaign email, deals, tasks, meetings, proposals)", async () => {
      const now = new Date().toISOString();
      const person = (id: string) => ({ source: "quickicp", externalId: id, fullName: `Person ${id}`, email: `${id}@acme.com` });
      await brain("/contacts", [person("p1"), person("p2"), person("p3")]); // p3 stays a prospect
      await brain("/calls", [{ source: "quickhowl", externalId: "call-1", contact: { source: "quickicp", externalId: "p2" }, connected: true, outcome: "interested" }]);
      const email = { source: "email_tool", messageId: "m-1", contact: { source: "quickicp", externalId: "p1" }, campaignRef: "camp", step: 1, occurredAt: now };
      await brain("/email-events", [{ ...email, event: "sent" }, { ...email, event: "replied", replyText: "Tell me more" }]);

      const d1 = await newDeal();
      expect((await api("post", `/contacts/${d1.contactId}/calls`, { connected: false, notConnectedReason: "no_answer" })).status).toBe(201);
      const d2 = await newDeal();
      await api("post", `/deals/${d2.dealId}/won`, {});
      const d3 = await newDeal();
      await api("post", `/deals/${d3.dealId}/lost`, { lossReason: "price_budget" });
      const old = await newDeal();
      await api("post", `/deals/${old.dealId}/won`, {});
      await seed.query(`update crm.timeline_events set occurred_at = now() - interval '40 days' where deal_id = $1 and title = 'Won'`, [old.dealId]);
      await newDeal(); // open, its task is cancelled below -> missing next action

      // Replace the auto-created tasks with known ones on d1.
      await seed.query(`update crm.tasks set status = 'cancelled', cancelled_at = now() where workspace_id = $1 and status = 'open'`, [w1]);
      await seed.query(
        `insert into crm.tasks (workspace_id, deal_id, task_type, title, due_at) values
           ($1, $2, 'call', 'earlier today', ${TODAY} + interval '1 second'),
           ($1, $2, 'call', 'two days ago', now() - interval '2 days'),
           ($1, $2, 'call', 'tomorrow', ${TODAY} + interval '25 hours')`,
        [w1, d1.dealId],
      );
      await seed.query(
        `insert into crm.meetings (workspace_id, deal_id, title, scheduled_at, status) values
           ($1, $2, 'today', ${TODAY} + interval '1 second', 'scheduled'),
           ($1, $2, 'cancelled today', ${TODAY} + interval '2 seconds', 'cancelled'),
           ($1, $2, 'tomorrow', ${TODAY} + interval '25 hours', 'scheduled')`,
        [w1, d1.dealId],
      );
      await seed.query(
        `insert into crm.proposals (workspace_id, deal_id, title, status, sent_at) values ($1, $2, 'sent', 'sent', now()), ($1, $2, 'draft', 'draft', null)`,
        [w1, d1.dealId],
      );

      const s = await summary();
      expect(s.lifecycleFunnel.map((r: { stage: string }) => r.stage)).toEqual(["prospect", "contacted", "engaged", "qualified", "customer"]);
      expect(nonZero(s.lifecycleFunnel)).toEqual({ prospect: 1, engaged: 2, qualified: 3, customer: 2 });
      expect(nonZero(s.openDealsByStage)).toEqual({ not_connected_nurture: 1, new: 1 });
      expect(s).toMatchObject({
        dealsThisMonth: { won: 1, lost: 1 },
        activityThisWeek: { aiCalls: 1, humanCalls: 1, emailsSent: 1, emailsReplied: 1 },
        tasks: { dueToday: 1, overdue: 2 },
        openDealsMissingNextAction: 1,
        meetingsToday: 1,
        proposalsAwaitingDecision: 1,
      });
    });

    it("does not count another workspace's data", async () => {
      const before = await summary();
      const other = await newDeal(w2);
      await api("post", `/deals/${other.dealId}/won`, {}, w2);
      await newDeal(w2);
      await seed.query(`insert into crm.calls (workspace_id, contact_id, connected, source) values ($1, $2, true, 'ai')`, [w2, other.contactId]);
      await seed.query(`insert into crm.email_activities (workspace_id, contact_id, sent_at, replied_at, status) values ($1, $2, now(), now(), 'replied')`, [w2, other.contactId]);

      expect(await summary()).toEqual(before);
      const s2 = await summary(w2);
      expect(s2).toMatchObject({ dealsThisMonth: { won: 1, lost: 0 }, activityThisWeek: { aiCalls: 1, humanCalls: 0, emailsSent: 1, emailsReplied: 1 } });
      expect(nonZero(s2.lifecycleFunnel)).toEqual({ qualified: 1, customer: 1 });
    });
  });

  describe("notifications", () => {
    let w2Note: string;

    it("never go to admins, even as workspace members", async () => {
      await brain("/handovers", [{ source: "quickicp", externalId: "h-1", contact: { source: "quickicp", externalId: "p3" }, summary: "Fit" }]);
      const mine = (await api("get", "/notifications")).body.data;
      expect(mine).toEqual([expect.objectContaining({ title: "New qualified handover", read: false })]);

      const res = await api("get", "/notifications", undefined, w1, admin);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect((await seed.query(`select count(*)::int n from crm.notifications where recipient_id = $1`, [admin])).rows[0].n).toBe(0);
    });

    it("from another workspace are not visible or markable", async () => {
      w2Note = (await seed.query(`insert into crm.notifications (workspace_id, recipient_id, title) values ($1, $2, 'w2 news') returning id`, [w2, sam])).rows[0].id;
      expect((await api("get", "/notifications")).body.data.map((x: { title: string }) => x.title)).not.toContain("w2 news");
      expect((await api("post", `/notifications/${w2Note}/read`)).status).toBe(404);
      expect((await api("post", "/notifications/not-a-uuid/read")).status).toBe(404);
    });

    it("read-all only marks the current workspace", async () => {
      const res = await api("post", "/notifications/read-all");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((x: { read: boolean }) => x.read)).toBe(true);
      expect((await api("get", "/notifications", undefined, w2)).body.data).toEqual([expect.objectContaining({ id: w2Note, read: false })]);
    });
  });
});
