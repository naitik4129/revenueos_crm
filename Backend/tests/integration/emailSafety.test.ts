/**
 * Scale step 10: email safety on the PGlite test database. Fake Resend webhook payloads (signed
 * like Svix does), the unsubscribe link/page, the 7-day auto-pause and the MX check.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));
const mocks = vi.hoisted(() => ({ sendEmail: vi.fn(), hasMx: vi.fn() }));
vi.mock("../../src/providers/email.provider.js", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("../../src/services/email-safety.service.js", async (original) => ({
  ...(await original<typeof import("../../src/services/email-safety.service.js")>()),
  domainHasMx: mocks.hasMx,
}));

type Safety = typeof import("../../src/services/email-safety.service.js");
type Db = typeof import("../../src/db.js");

describe("email safety (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let db: Db;
  let safety: Safety;
  let runner: typeof import("../../src/services/automation-runner.js");
  let admin: string;
  let sam: string;
  let ws: string;
  let n = 0;
  let msg = 0;

  const api = (method: "get" | "post" | "patch" | "put", path: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${sam}`).set("X-Workspace-Id", ws);
    return body ? r.send(body) : r;
  };
  const one = async (sql: string, params: unknown[] = []) => (await seed.query(sql, params)).rows[0];
  const channel = async (contactId: string) => (await one(`select status, reason from crm.contact_channels where contact_id = $1 and channel = 'email'`, [contactId])) ?? null;

  /** A new deal (enrolled in the one-step email workflow), its contact and its claimed-and-run action. */
  async function workflowEmail() {
    const contactId = (await api("post", "/contacts", { firstName: "Asha", email: `asha${++n}@acme.com` })).body.id as string;
    const dealId = (await api("post", "/deals", { contactId })).body.id as string;
    await runner.runAutomationTick({ batchSize: 50, dryRun: false });
    return { contactId, dealId, action: await one(`select id, status, last_error from crm.scheduled_actions where deal_id = $1`, [dealId]) };
  }

  const secret = () => process.env.RESEND_WEBHOOK_SECRET!;
  function webhook(event: object, opts: { secret?: string; at?: number; id?: string } = {}) {
    const body = JSON.stringify(event);
    const id = opts.id ?? `msg_${++msg}`;
    const ts = String(Math.floor((opts.at ?? Date.now()) / 1000));
    const key = Buffer.from((opts.secret ?? secret()).replace(/^whsec_/, ""), "base64");
    const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    return request(app).post("/api/v1/webhooks/resend").set("content-type", "application/json").set("svix-id", id).set("svix-timestamp", ts).set("svix-signature", `v1,${sig}`).send(body);
  }
  const bounce = (emailId: string, type = "Permanent") => webhook({ type: "email.bounced", data: { email_id: emailId, bounce: { type, message: "Mailbox does not exist" } } });

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    db = await import("../../src/db.js");
    safety = await import("../../src/services/email-safety.service.js");
    runner = await import("../../src/services/automation-runner.js");
    const user = async (email: string, role: string) => {
      const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
      await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $2)`, [id, email]);
      await seed.query(`insert into crm.profiles (id, role) values ($1, $2)`, [id, role]);
      return id;
    };
    admin = await user("admin@x.com", "admin");
    sam = await user("sam@x.com", "salesperson");
    ws = (await seed.query(`insert into crm.workspaces (name, slug) values ('Acme <Client>', 'one') returning id`)).rows[0].id;
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $2)`, [ws, sam]);
    await seed.query(
      `insert into crm.send_policies (workspace_id, channel, daily_cap, ramp_start, min_gap_seconds, max_gap_seconds, window_start, window_end, window_days)
       values ($1, 'email', 2000, 2000, 0, 0, '00:00', '24:00', '{1,2,3,4,5,6,7}')`,
      [ws],
    );
    const templateId = (await api("post", "/templates", { name: "Intro", channel: "email", subject: "Hi", body: "<p>Hi {{contact.firstName}}</p>" })).body.id;
    const wf = (await api("post", "/workflows", { name: "Nurture", trigger: "deal_created" })).body;
    await api("put", `/workflows/${wf.id}/versions/1/steps`, { steps: [{ order: 0, delayDays: 0, enabled: true, action: "send_email", templateId }] });
    await api("post", `/workflows/${wf.id}/versions/1/publish`, {});
    await api("patch", `/workflows/${wf.id}`, { status: "active" });
  }, 60_000);

  afterAll(async () => {
    await db?.pool.end();
    await seed?.end();
    await testDb?.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockImplementation(async () => ({ providerMessageId: `re_${++msg}` }));
    mocks.hasMx.mockResolvedValue(true);
  });

  it("unsubscribe tokens: unguessable, tamper-proof, one per contact", () => {
    const id = "6f1c2a9e-1b2c-4d3e-8f90-123456789abc";
    const token = safety.unsubscribeToken(id);
    expect(safety.verifyUnsubscribeToken(token)).toBe(id);
    const [idPart, mac] = token.split(".");
    const other = safety.unsubscribeToken("6f1c2a9e-1b2c-4d3e-8f90-123456789abd");
    expect(safety.verifyUnsubscribeToken(`${other.split(".")[0]}.${mac}`)).toBeNull();
    expect(safety.verifyUnsubscribeToken(`${idPart}.${mac!.slice(0, -2)}AA`)).toBeNull();
    expect(safety.verifyUnsubscribeToken("garbage")).toBeNull();
    expect(safety.verifyUnsubscribeToken(`${idPart}.${mac}.x`)).toBeNull();
  });

  it("every workflow email carries the unsubscribe link and List-Unsubscribe headers, and is recorded", async () => {
    const { contactId, action } = await workflowEmail();
    expect(action.status).toBe("completed");
    const url = `https://crm-api.test/u/${safety.unsubscribeToken(contactId)}`;
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        html: expect.stringContaining(`<a href="${url}">Unsubscribe</a>`),
        headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    );
    expect(await one(`select contact_id, to_email from crm.email_sends where scheduled_action_id = $1`, [action.id])).toEqual({ contact_id: contactId, to_email: `asha${n}@acme.com` });
  });

  it("/u/:token: GET only asks (no login), POST unsubscribes once; a bad token is 404; the next email is skipped", async () => {
    const { contactId } = await workflowEmail();
    const path = `/u/${safety.unsubscribeToken(contactId)}`;
    const page = await request(app).get(path);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Stop getting emails from Acme &#60;Client&#62;?");
    expect(await channel(contactId)).toBeNull();

    const done = await request(app).post(path).type("form").send("List-Unsubscribe=One-Click");
    expect(done.status).toBe(200);
    expect(done.text).toContain("You're unsubscribed");
    expect(await channel(contactId)).toEqual({ status: "unsubscribed", reason: "Unsubscribed by email link" });
    await request(app).post(path);
    expect((await one(`select count(*)::int as n from crm.timeline_events where contact_id = $1 and title = 'email contactability: unsubscribed'`, [contactId])).n).toBe(1);
    expect((await request(app).get(path)).text).toContain("You're unsubscribed");
    expect((await request(app).get(`/u/${path.slice(3, -3)}AAA`)).status).toBe(404);

    // Unsubscribed before its deal exists: the workflow's email is skipped, the run carries on.
    const fresh = (await api("post", "/contacts", { firstName: "Ravi", email: `ravi${++n}@acme.com` })).body.id as string;
    await request(app).post(`/u/${safety.unsubscribeToken(fresh)}`);
    const dealId = (await api("post", "/deals", { contactId: fresh })).body.id;
    mocks.sendEmail.mockClear();
    await runner.runAutomationTick({ batchSize: 50, dryRun: false });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(await one(`select status, last_error from crm.scheduled_actions where deal_id = $1`, [dealId])).toEqual({ status: "skipped", last_error: 'Email channel is "unsubscribed".' });
  });

  describe("Resend webhook", () => {
    it("refuses a missing, wrong or stale signature", async () => {
      const event = { type: "email.bounced", data: { email_id: "x", bounce: { type: "Permanent" } } };
      expect((await request(app).post("/api/v1/webhooks/resend").send(event)).status).toBe(401);
      expect((await webhook(event, { secret: `whsec_${Buffer.alloc(24, 1).toString("base64")}` })).status).toBe(401);
      expect((await webhook(event, { at: Date.now() - 10 * 60_000 })).status).toBe(401);
      expect((await webhook(event)).body).toEqual({ result: "ignored" });
    });

    it("a hard bounce blocks the address (once); a soft bounce does not; a complaint unsubscribes", async () => {
      const a = await workflowEmail();
      const emailId = (await one(`select provider_message_id from crm.email_sends where contact_id = $1`, [a.contactId])).provider_message_id;
      expect((await bounce(emailId, "Transient")).body).toEqual({ result: "ignored" });
      expect(await channel(a.contactId)).toBeNull();
      expect((await bounce(emailId)).body).toEqual({ result: "bounced" });
      expect(await channel(a.contactId)).toEqual({ status: "permanent_bounce", reason: "Hard bounce: Mailbox does not exist" });
      expect((await bounce(emailId)).body).toEqual({ result: "ignored" });

      const b = await workflowEmail();
      const bId = (await one(`select provider_message_id from crm.email_sends where contact_id = $1`, [b.contactId])).provider_message_id;
      expect((await webhook({ type: "email.complained", data: { email_id: bId } })).body).toEqual({ result: "complained" });
      expect(await channel(b.contactId)).toEqual({ status: "unsubscribed", reason: "Marked a nurture email as spam" });
      expect((await webhook({ type: "email.delivered", data: { email_id: bId } })).body).toEqual({ result: "ignored" });
    });

    it("pauses the email channel at 3% hard bounces + complaints over 7 days (min 50 sends) and alerts admins only", async () => {
      await seed.query(`delete from crm.email_sends`);
      const send = (i: number, daysAgo = 0) =>
        seed.query(`insert into crm.email_sends (workspace_id, provider_message_id, to_email, sent_at) values ($1, $2, 'x@acme.com', now() - $3::interval)`, [ws, `bulk_${i}`, `${daysAgo} days`]);
      for (let i = 0; i < 40; i++) await send(i);
      for (let i = 40; i < 50; i++) await send(i, 8); // older than 7 days: not counted
      for (let i = 0; i < 2; i++) await bounce(`bulk_${i}`);
      expect((await one(`select paused from crm.send_policies where workspace_id = $1 and channel = 'email'`, [ws])).paused).toBe(false); // 2 of 40 < 50 sends

      for (let i = 50; i < 70; i++) await send(i);
      await bounce("bulk_2"); // 3 of 60 = 5%
      const policy = await one(`select paused, pause_reason, paused_at from crm.send_policies where workspace_id = $1 and channel = 'email'`, [ws]);
      expect(policy).toMatchObject({ paused: true, pause_reason: "Bounce + complaint rate 5.0% over 7 days (3 of 60 sends)." });
      const alerts = (await seed.query(`select recipient_id, title, kind from crm.notifications where workspace_id = $1`, [ws])).rows;
      expect(alerts).toEqual([{ recipient_id: admin, title: "Email sending paused automatically", kind: "warning" }]);

      await webhook({ type: "email.complained", data: { email_id: "bulk_3" } });
      expect((await seed.query(`select 1 from crm.notifications where workspace_id = $1`, [ws])).rowCount).toBe(1); // already paused: no second alert

      const { action } = await workflowEmail();
      expect(action).toMatchObject({ status: "pending", last_error: expect.stringContaining("Email sending is paused: Bounce + complaint rate") });
      await seed.query(`update crm.send_policies set paused = false, pause_reason = null where workspace_id = $1`, [ws]);
      await seed.query(`delete from crm.email_sends where provider_message_id like 'bulk_%'`);
    });
  });

  it("no MX for the domain: the email is skipped, the address marked invalid, nothing sent", async () => {
    mocks.hasMx.mockResolvedValue(false);
    const { contactId, action } = await workflowEmail();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(action).toMatchObject({ status: "skipped", last_error: `No mail server (MX) for acme.com.` });
    expect(await channel(contactId)).toEqual({ status: "invalid", reason: "No mail server (MX) for acme.com." });
  });

  it("domainHasMx: no domain / no MX is false and cached a day; a DNS failure never blocks", async () => {
    const real = (await vi.importActual<Safety>("../../src/services/email-safety.service.js")).domainHasMx;
    const resolve = vi.fn(async (domain: string): Promise<unknown[]> => {
      if (domain === "nomx.test") throw Object.assign(new Error("no data"), { code: "ENODATA" });
      if (domain === "gone.test") throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      if (domain === "flaky.test") throw Object.assign(new Error("servfail"), { code: "ESERVFAIL" });
      return [{ exchange: "mx.ok.test", priority: 10 }];
    });
    expect(await real("a@nomx.test", resolve)).toBe(false);
    expect(await real("b@NOMX.test", resolve)).toBe(false);
    expect(await real("a@gone.test", resolve)).toBe(false);
    expect(await real("a@flaky.test", resolve)).toBe(true);
    expect(await real("a@ok.test", resolve)).toBe(true);
    expect(resolve.mock.calls.map((c) => c[0])).toEqual(["nomx.test", "gone.test", "flaky.test", "ok.test"]);
  });
});
