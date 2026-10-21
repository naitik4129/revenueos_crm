/**
 * Scale step 9: sending policies (migration 015) on the PGlite test database. checkSendPolicy is
 * driven with fixed IST times; the runner test checks the worker defers instead of sending.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));
const sendEmail = vi.fn(async () => ({ providerMessageId: "resend-1" }));
vi.mock("../../src/providers/email.provider.js", () => ({ sendEmail }));
// No DNS in tests: every domain has a mail server (emailSafety.test.ts covers the MX check).
vi.mock("../../src/services/email-safety.service.js", async (original) => ({
  ...(await original<typeof import("../../src/services/email-safety.service.js")>()),
  domainHasMx: async () => true,
}));

type Policy = typeof import("../../src/services/send-policy.service.js");
type Db = typeof import("../../src/db.js");

// 2026-10-19 is a Monday.
const ist = (local: string) => new Date(`${local}+05:30`);

describe("send policies (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let db: Db;
  let policy: Policy;
  let sam: string;
  let admin: string;
  let ws: string;
  let contactId: string;
  let n = 0;

  const api = (method: "get" | "post" | "patch" | "put", path: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${sam}`).set("X-Workspace-Id", ws);
    return body ? r.send(body) : r;
  };
  const one = async (sql: string, params: unknown[] = []) => (await seed.query(sql, params)).rows[0];
  const newContact = async () => (await api("post", "/contacts", { firstName: "Asha", email: `asha${++n}@acme.com` })).body.id as string;
  const check = (at: Date, channel: "email" | "whatsapp" = "email", contact = contactId, random = () => 0.5) =>
    db.withTransaction((c) => policy.checkSendPolicy(c, { workspaceId: ws, channel, contactId: contact }, at, random));
  const setPolicy = (sets: string, channel = "email") => seed.query(`update crm.send_policies set ${sets} where workspace_id = $1 and channel = $2`, [ws, channel]);

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    db = await import("../../src/db.js");
    policy = await import("../../src/services/send-policy.service.js");
    sam = (await seed.query(`insert into auth.users (email) values ('sam@x.com') returning id`)).rows[0].id;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, 'Sam', 'sam@x.com')`, [sam]);
    await seed.query(`insert into crm.profiles (id, role) values ($1, 'salesperson')`, [sam]);
    admin = (await seed.query(`insert into auth.users (email) values ('admin@x.com') returning id`)).rows[0].id;
    await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, 'Asha', 'admin@x.com')`, [admin]);
    await seed.query(`insert into crm.profiles (id, role) values ($1, 'admin')`, [admin]);
    ws = (await seed.query(`insert into crm.workspaces (name, slug) values ('One', 'one') returning id`)).rows[0].id;
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $2)`, [ws, sam]);
    contactId = (await api("post", "/contacts", { firstName: "Ravi", email: "ravi@acme.com", phone: "+919876543210" })).body.id;
  }, 60_000);

  afterAll(async () => {
    await db?.pool.end();
    await seed?.end();
    await testDb?.stop();
  });

  beforeEach(() => seed.query(`delete from crm.send_policies`));

  it("creates each channel's row with its defaults on first use", async () => {
    await db.withTransaction((c) => policy.getSendPolicy(c, ws, "email"));
    await db.withTransaction((c) => policy.getSendPolicy(c, ws, "whatsapp"));
    const rows = (await seed.query(`select channel, daily_cap, ramp_start, ramp_step_per_day, min_gap_seconds, max_gap_seconds, window_days from crm.send_policies order by channel`)).rows;
    expect(rows).toEqual([
      { channel: "email", daily_cap: 50, ramp_start: 20, ramp_step_per_day: 5, min_gap_seconds: 60, max_gap_seconds: 180, window_days: [1, 2, 3, 4, 5] },
      { channel: "whatsapp", daily_cap: 60, ramp_start: 20, ramp_step_per_day: 5, min_gap_seconds: 45, max_gap_seconds: 120, window_days: [1, 2, 3, 4, 5] },
    ]);
  });

  it("paused: defers an hour with the reason, uses no slot", async () => {
    await check(ist("2026-10-19T10:00:00"));
    await setPolicy(`paused = true, pause_reason = 'Bounce rate 4%', next_send_at = null`);
    const at = ist("2026-10-19T11:00:00");
    expect(await check(at)).toEqual({ ok: false, kind: "defer", reason: "Email sending is paused: Bounce rate 4%", retryAt: new Date(at.getTime() + 3_600_000) });
    expect((await one(`select sent_today from crm.send_policies where channel = 'email'`)).sent_today).toBe(1);
  });

  it("working hours (IST, weekdays): defers to the next window opening", async () => {
    const early = await check(ist("2026-10-19T08:15:00"));
    expect(early).toMatchObject({ ok: false, kind: "defer", retryAt: ist("2026-10-19T09:00:00") });
    expect(early.ok === false && early.reason).toBe("Outside Email sending hours (09:00-19:00 IST).");
    expect(await check(ist("2026-10-23T19:00:00"))).toMatchObject({ kind: "defer", retryAt: ist("2026-10-26T09:00:00") }); // Friday evening -> Monday
    expect(await check(ist("2026-10-24T12:00:00"))).toMatchObject({ kind: "defer", retryAt: ist("2026-10-26T09:00:00") }); // Saturday
    await setPolicy(`window_days = '{6}', window_start = '10:00', window_end = '12:00'`);
    expect(await check(ist("2026-10-24T11:00:00"))).toEqual({ ok: true });
  });

  it("daily cap with warm-up ramp: 20 on day one, +5 a day, up to the cap; over it waits for the next day's window", async () => {
    await check(ist("2026-10-19T09:00:00"));
    await setPolicy(`min_gap_seconds = 0, max_gap_seconds = 0, sent_today = 0`);
    const monday = ist("2026-10-19T10:00:00");
    for (let i = 0; i < 20; i++) expect(await check(monday)).toEqual({ ok: true });
    const over = await check(monday);
    expect(over).toMatchObject({ ok: false, kind: "defer", reason: "Email daily cap reached (20/20 today).", retryAt: ist("2026-10-20T09:00:00") });

    // Tuesday: a new IST day, the ramp is one day in -> 25.
    const tuesday = ist("2026-10-20T09:30:00");
    for (let i = 0; i < 25; i++) expect(await check(tuesday)).toEqual({ ok: true });
    expect(await check(tuesday)).toMatchObject({ kind: "defer", reason: "Email daily cap reached (25/25 today)." });

    // Friday's cap is reached late at night -> the next window is Monday.
    await seed.query(`update crm.send_policies set ramp_started_at = $2, counter_day = '2026-10-23', sent_today = 50 where workspace_id = $1`, [ws, ist("2026-10-01T10:00:00")]);
    expect(await check(ist("2026-10-23T18:00:00"))).toMatchObject({ kind: "defer", reason: "Email daily cap reached (50/50 today).", retryAt: ist("2026-10-26T09:00:00") });
    expect(policy.capForDay({ daily_cap: 50, ramp_start: 20, ramp_step_per_day: 5, ramp_started_at: ist("2026-10-19T23:59:00") }, ist("2026-10-21T00:01:00"))).toBe(30);
  });

  it("random gap: one send per gap, the next waits until the reserved time (no bursts)", async () => {
    const at = ist("2026-10-19T10:00:00");
    expect(await check(at, "whatsapp", contactId, () => 0.5)).toEqual({ ok: true });
    const next = new Date(at.getTime() + 82_500); // 45 + 0.5 * (120 - 45) s
    expect(await check(at, "whatsapp")).toMatchObject({ ok: false, kind: "defer", retryAt: next });
    expect(await check(new Date(next.getTime() - 1000), "whatsapp")).toMatchObject({ kind: "defer" });
    expect(await check(next, "whatsapp", contactId, () => 0)).toEqual({ ok: true });
    expect((await one(`select next_send_at from crm.send_policies where channel = 'whatsapp'`)).next_send_at).toEqual(new Date(next.getTime() + 45_000));
  });

  it("consent comes last: a DNC contact is a skip and uses no slot", async () => {
    const dnc = await newContact();
    expect((await api("post", "/contacts/bulk", { action: "dnc", ids: [dnc], reason: "Asked" })).status).toBe(200);
    expect(await check(ist("2026-10-19T10:00:00"), "email", dnc)).toEqual({ ok: false, kind: "skip", reason: "Contact is Do Not Contact." });
    expect((await one(`select sent_today, next_send_at from crm.send_policies where channel = 'email'`))).toEqual({ sent_today: 0, next_send_at: null });
  });

  it("worker: a send over the policy is deferred with its reason (provider never called); allowed, it sends and counts", async () => {
    const templateId = (await api("post", "/templates", { name: "Intro", channel: "email", subject: "Hi", body: "<p>Hi</p>" })).body.id;
    const wf = (await api("post", "/workflows", { name: "Nurture", trigger: "deal_created" })).body;
    await api("put", `/workflows/${wf.id}/versions/1/steps`, { steps: [{ order: 0, delayDays: 0, enabled: true, action: "send_email", templateId }] });
    await api("post", `/workflows/${wf.id}/versions/1/publish`, {});
    await api("patch", `/workflows/${wf.id}`, { status: "active" });
    const deal = (await api("post", "/deals", { contactId: await newContact() })).body.id;

    const runner = await import("../../src/services/automation-runner.js");
    const opts = { batchSize: 50, dryRun: false };
    await db.withTransaction((c) => policy.getSendPolicy(c, ws, "email"));
    await setPolicy(`paused = true, pause_reason = 'Checked by hand'`);
    await runner.runAutomationTick(opts);
    const action = await one(`select status, last_error, scheduled_for, attempt_count from crm.scheduled_actions where deal_id = $1`, [deal]);
    expect(action).toMatchObject({ status: "pending", last_error: "Email sending is paused: Checked by hand", attempt_count: 0 });
    expect(action.scheduled_for.getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);
    expect(sendEmail).not.toHaveBeenCalled();

    await setPolicy(`paused = false, pause_reason = null, window_start = '00:00', window_end = '24:00', window_days = '{1,2,3,4,5,6,7}'`);
    await seed.query(`update crm.scheduled_actions set scheduled_for = now() where deal_id = $1`, [deal]);
    await runner.runAutomationTick(opts);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await one(`select status from crm.scheduled_actions where deal_id = $1`, [deal])).toEqual({ status: "completed" });
    expect((await one(`select sent_today from crm.send_policies where channel = 'email'`)).sent_today).toBe(1);
  });

  describe("admin Sending API (step 12)", () => {
    const as = (user: string, method: "get" | "patch", path: string, body?: object) => {
      const r = request(app)[method](`/api/v1/admin/sending${path}`).set("Authorization", `Bearer ${user}`);
      return body ? r.send(body) : r;
    };

    it("admins only; an unknown workspace is 404", async () => {
      expect((await as(sam, "get", `/${ws}`)).status).toBe(403);
      expect((await as(sam, "patch", `/${ws}/email`, { dailyCap: 30 })).status).toBe(403);
      expect((await as(admin, "get", "/6f1c2a9e-1b2c-4d3e-8f90-123456789abc")).status).toBe(404);
    });

    it("shows both channels with today's count, today's cap and the ramp day", async () => {
      const fresh = await as(admin, "get", `/${ws}`);
      expect(fresh.status).toBe(200);
      expect(fresh.body.email).toMatchObject({ channel: "email", paused: false, dailyCap: 50, safeMaxDailyCap: 500, todayCap: 20, sentToday: 0, rampDay: null, windowStart: "09:00", windowEnd: "19:00", windowDays: [1, 2, 3, 4, 5] });
      expect(fresh.body.whatsapp).toMatchObject({ channel: "whatsapp", dailyCap: 60, safeMaxDailyCap: 250, minGapSeconds: 45, maxGapSeconds: 120 });

      await setPolicy(`window_start = '00:00', window_end = '24:00', window_days = '{1,2,3,4,5,6,7}', min_gap_seconds = 0, max_gap_seconds = 0`);
      await check(new Date());
      await check(new Date());
      await seed.query(`update crm.send_policies set ramp_started_at = now() - interval '2 days' where channel = 'email'`);
      expect((await as(admin, "get", `/${ws}`)).body.email).toMatchObject({ sentToday: 2, rampDay: 3, todayCap: 30 });
    });

    it("refuses unsafe or inconsistent values with every reason", async () => {
      const bad = async (channel: string, body: object) => {
        const res = await as(admin, "patch", `/${ws}/${channel}`, body);
        expect(res.status).toBe(400);
        return res.body.error.message as string;
      };
      expect(await bad("email", { dailyCap: 501 })).toBe("Daily cap can be at most 500 for Email.");
      expect(await bad("whatsapp", { dailyCap: 251, rampStart: 300 })).toBe("Daily cap can be at most 250 for WhatsApp. Ramp start can't be above the daily cap.");
      expect(await bad("email", { minGapSeconds: 200, maxGapSeconds: 100 })).toBe("Minimum gap can't be above the maximum gap.");
      expect(await bad("email", { windowStart: "18:00", windowEnd: "09:00" })).toBe("Sending hours must start before they end.");
      expect(await bad("email", { windowDays: [1, 1] })).toBe("Each sending day can be listed once.");
      expect(await bad("email", { paused: true })).toBe("Say why the channel is paused.");
      await bad("email", { windowStart: "9am" });
      await bad("email", { windowDays: [] });
      await bad("email", { dailyCap: 0 });
      await bad("email", { sentToday: 0 });
      await bad("email", {});
      expect((await as(admin, "patch", `/${ws}/sms`, { dailyCap: 10 })).status).toBe(400);
    });

    it("saves every field, pauses with a reason, resumes, restarts the ramp; each change is audited", async () => {
      const body = { dailyCap: 120, rampStart: 30, rampStepPerDay: 10, minGapSeconds: 90, maxGapSeconds: 240, windowStart: "10:00", windowEnd: "18:30", windowDays: [6, 1, 3] };
      const saved = await as(admin, "patch", `/${ws}/email`, body);
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ ...body, windowDays: [1, 3, 6] });

      const paused = await as(admin, "patch", `/${ws}/email`, { paused: true, pauseReason: "  New domain warming up  " });
      expect(paused.body).toMatchObject({ paused: true, pauseReason: "New domain warming up", pausedAt: expect.any(String) });
      expect(await check(new Date())).toMatchObject({ ok: false, reason: "Email sending is paused: New domain warming up" });

      await seed.query(`update crm.send_policies set ramp_started_at = now() - interval '5 days' where channel = 'email'`);
      const resumed = await as(admin, "patch", `/${ws}/email`, { paused: false, restartRamp: true });
      expect(resumed.body).toMatchObject({ paused: false, pauseReason: null, pausedAt: null, rampStartedAt: null, rampDay: null, todayCap: 30 });
      expect((await one(`select updated_by from crm.send_policies where channel = 'email'`)).updated_by).toBe(admin);

      const audits = (await seed.query(`select action, target_id, metadata from crm.admin_audit_events where action like 'sending.%' order by created_at`)).rows;
      expect(audits.map((a) => a.action)).toEqual(["sending.email.update", "sending.email.update", "sending.email.update"]);
      expect(audits[2]).toMatchObject({ target_id: ws, metadata: { paused: false, restartRamp: true } });
    });
  });
});
