/**
 * Scale step 11: WhatsApp safety on the PGlite test database, with a fake Baileys client. The
 * engaged-only gate (worker), STOP replies, and the auto-pause on failures, restrictions and logout.
 */
import { DisconnectReason } from "baileys";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) } },
}));
const mocks = vi.hoisted(() => ({ sendWhatsApp: vi.fn() }));
vi.mock("../../src/providers/whatsapp.provider.js", () => ({ sendWhatsApp: mocks.sendWhatsApp }));

type Manager = typeof import("../../src/providers/baileys.manager.js");
type Safety = typeof import("../../src/services/whatsapp-safety.service.js");
type Db = typeof import("../../src/db.js");

describe("WhatsApp safety (PGlite, fake Baileys)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let db: Db;
  let safety: Safety;
  let manager: Manager;
  let runner: typeof import("../../src/services/automation-runner.js");
  let inbound: typeof import("../../src/services/whatsapp-inbound.service.js");
  let admin: string;
  let sam: string;
  let ws: string;
  let n = 0;

  const api = (method: "get" | "post" | "patch" | "put", path: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${sam}`).set("X-Workspace-Id", ws);
    return body ? r.send(body) : r;
  };
  const one = async (sql: string, params: unknown[] = []) => (await seed.query(sql, params)).rows[0];
  const phoneOf = (i: number) => `+9198765${String(43000 + i).padStart(5, "0")}`;
  const newContact = async () => {
    const phone = phoneOf(++n);
    const id = (await api("post", "/contacts", { firstName: "Asha", phone })).body.id as string;
    return { id, phone };
  };
  const channel = async (contactId: string) => (await one(`select status, reason from crm_contact_channels where contact_id = $1 and channel = 'whatsapp'`, [contactId])) ?? null;
  const policy = () => one(`select paused, pause_reason from crm_send_policies where workspace_id = $1 and channel = 'whatsapp'`, [ws]);
  const openPolicy = () =>
    seed.query(
      `insert into crm_send_policies (workspace_id, channel, daily_cap, ramp_start, min_gap_seconds, max_gap_seconds, window_start, window_end, window_days)
       values ($1, 'whatsapp', 2000, 2000, 0, 0, '00:00', '24:00', '{1,2,3,4,5,6,7}')
       on conflict (workspace_id, channel) do update set paused = false, pause_reason = null, paused_at = null`,
      [ws],
    );
  const inboundText = (phone: string, text: object) =>
    ({ type: "notify", messages: [{ key: { id: `in-${++n}`, remoteJid: `${phone.slice(1)}@s.whatsapp.net`, fromMe: false }, message: text, messageTimestamp: Math.floor(Date.now() / 1000) }] }) as never;

  /** A fake Baileys socket: no restriction, every number registered, sendMessage as given. */
  const fakeSocket = (over: Record<string, unknown> = {}) =>
    ({
      user: { id: "919000000000:1@s.whatsapp.net" },
      fetchAccountReachoutTimelock: async () => ({ isActive: false }),
      fetchNewChatMessageCap: async () => null,
      onWhatsApp: async () => [{ exists: true, jid: "x@s.whatsapp.net" }],
      sendMessage: vi.fn(async () => ({ message: { conversation: "sent" } })),
      end: () => undefined,
      ...over,
    }) as never;
  /** A manager for `ws` holding a connected fake socket (no real session). */
  const connectedManager = (socket: unknown) => {
    const m = new manager.BaileysManager(ws) as unknown as { socket: unknown; connected: boolean; sendAction: InstanceType<Manager["BaileysManager"]>["sendAction"] };
    m.socket = socket;
    m.connected = true;
    return m;
  };
  /** A proposal WhatsApp send in progress for a new contact (a send source the claim accepts). */
  const proposalSend = async () => {
    const contact = await newContact();
    const dealId = (await api("post", "/deals", { contactId: contact.id })).body.id;
    const proposalId = (await api("post", "/proposals", { dealId, title: "Offer" })).body.id;
    await seed.query(`update crm_proposals set whatsapp_send_status = 'sending' where id = $1`, [proposalId]);
    return { source: { type: "proposal" as const, id: proposalId }, phoneE164: contact.phone, body: "Here is the offer" };
  };

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    db = await import("../../src/db.js");
    safety = await import("../../src/services/whatsapp-safety.service.js");
    manager = await import("../../src/providers/baileys.manager.js");
    runner = await import("../../src/services/automation-runner.js");
    inbound = await import("../../src/services/whatsapp-inbound.service.js");
    const user = async (email: string, role: string) => {
      const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
      await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $2)`, [id, email]);
      await seed.query(`insert into crm_profiles (id, role) values ($1, $2)`, [id, role]);
      return id;
    };
    admin = await user("admin@x.com", "admin");
    sam = await user("sam@x.com", "salesperson");
    ws = (await seed.query(`insert into crm_workspaces (name, slug) values ('One', 'one') returning id`)).rows[0].id;
    await seed.query(`insert into crm_workspace_members (workspace_id, user_id) values ($1, $2)`, [ws, sam]);
    await seed.query(`insert into crm_whatsapp_connection (workspace_id, enabled, status, desired_state) values ($1, true, 'connected', 'connected')`, [ws]);
  }, 60_000);

  afterAll(async () => {
    await db?.pool.end();
    await seed?.end();
    await testDb?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.sendWhatsApp.mockResolvedValue({ providerMessageId: "wa_1" });
    await openPolicy();
    await seed.query(`delete from crm_notifications`);
  });

  it("new connections space sends 45-120 s (017)", async () => {
    const other = (await seed.query(`insert into crm_workspaces (name, slug) values ('Two', 'two') returning id`)).rows[0].id;
    await seed.query(`insert into crm_whatsapp_connection (workspace_id) values ($1)`, [other]);
    expect(await one(`select min_delay_seconds, max_delay_seconds from crm_whatsapp_connection where workspace_id = $1`, [other])).toEqual({ min_delay_seconds: 45, max_delay_seconds: 120 });
  });

  describe("engaged-only gate (workflow WhatsApp)", () => {
    beforeAll(async () => {
      const templateId = (await api("post", "/templates", { name: "WA", channel: "whatsapp", body: "<p>Hi {{contact.firstName}}</p>" })).body.id;
      const wf = (await api("post", "/workflows", { name: "WA nurture", trigger: "deal_created" })).body;
      await api("put", `/workflows/${wf.id}/versions/1/steps`, { steps: [{ order: 0, delayDays: 0, enabled: true, action: "send_whatsapp", templateId }] });
      await api("post", `/workflows/${wf.id}/versions/1/publish`, {});
      await api("patch", `/workflows/${wf.id}`, { status: "active" });
    });
    afterAll(() => seed.query(`update crm_workflows set status = 'paused'`));

    /** Contact -> (prepare) -> deal (enrolls) -> one worker tick; returns the action. */
    const sendTo = async (prepare: (contactId: string) => Promise<unknown>) => {
      const { id } = await newContact();
      await prepare(id);
      const dealId = (await api("post", "/deals", { contactId: id })).body.id;
      await runner.runAutomationTick({ batchSize: 50, dryRun: false });
      return one(`select status, last_error from crm_scheduled_actions where deal_id = $1`, [dealId]);
    };

    it("a cold contact is skipped (timeline, run carries on), never sent", async () => {
      const action = await sendTo(async () => undefined);
      expect(action).toEqual({ status: "skipped", last_error: safety.NOT_ENGAGED });
      expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
      expect((await one(`select count(*)::int as n from crm_timeline_events where title = 'Automation Step Skipped' and detail = $1`, [safety.NOT_ENGAGED])).n).toBe(1);
    });

    it("a connected call (human or AI) or an opt-in makes the contact engaged", async () => {
      const call = (contactId: string, connected: boolean) =>
        seed.query(
          connected
            ? `insert into crm_calls (workspace_id, contact_id, connected, connected_outcome) values ($1, $2, true, 'positive')`
            : `insert into crm_calls (workspace_id, contact_id, connected, not_connected_reason) values ($1, $2, false, 'no_answer')`,
          [ws, contactId],
        );
      expect(await sendTo((id) => call(id, false))).toMatchObject({ status: "skipped" });
      expect(await sendTo((id) => call(id, true))).toEqual({ status: "completed", last_error: null });
      expect(await sendTo((id) => api("post", `/contacts/${id}/contactability`, { channel: "whatsapp", status: "opted_in", reason: "Said yes on the call" }).expect(200))).toEqual({
        status: "completed",
        last_error: null,
      });
      expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(2);
    });

    it("an inbound WhatsApp reply makes the contact engaged", async () => {
      const { id, phone } = await newContact();
      expect(await db.withTransaction((c) => safety.whatsappNotEngagedReason(c, id))).toBe(safety.NOT_ENGAGED);
      await inbound.processInboundUpsert(ws, inboundText(phone, { conversation: "Hi" }));
      expect(await db.withTransaction((c) => safety.whatsappNotEngagedReason(c, id))).toBeNull();
    });
  });

  describe("STOP replies", () => {
    it("recognises STOP / UNSUBSCRIBE / band karo, any case, trimmed; nothing longer", () => {
      for (const t of ["STOP", "  stop ", "Stop!", "UNSUBSCRIBE", "unsubscribe.", "Band  Karo", "band karo!"]) expect(safety.isStopReply(t)).toBe(true);
      for (const t of ["stop it", "please stop", "don't stop", "", null, undefined, "bandkaro"]) expect(safety.isStopReply(t)).toBe(false);
    });

    it("opts the number out and confirms once; later replies don't undo it; the text is never stored", async () => {
      const { id, phone } = await newContact();
      const reply = vi.fn(async () => undefined);
      await inbound.processInboundUpsert(ws, inboundText(phone, { conversation: "  Stop " }), reply);
      expect(await channel(id)).toEqual({ status: "opted_out", reason: "Replied STOP on WhatsApp" });
      expect(reply).toHaveBeenCalledExactlyOnceWith(`${phone.slice(1)}@s.whatsapp.net`, safety.OPT_OUT_CONFIRMATION);

      await inbound.processInboundUpsert(ws, inboundText(phone, { conversation: "STOP" }), reply);
      await inbound.processInboundUpsert(ws, inboundText(phone, { conversation: "ok thanks" }), reply);
      expect(reply).toHaveBeenCalledTimes(1);
      expect((await channel(id))!.status).toBe("opted_out");
      expect(JSON.stringify((await seed.query(`select * from crm_whatsapp_inbound_events where sender_phone_e164 = $1`, [phone])).rows)).not.toMatch(/stop|thanks/i);
      expect((await one(`select count(*)::int as n from crm_timeline_events where contact_id = $1 and title like 'WhatsApp opt-out (STOP)%'`, [id])).n).toBe(2);
    });

    it("'band karo' in an extended text message works; an ordinary reply only marks it reachable", async () => {
      const a = await newContact();
      const b = await newContact();
      const reply = vi.fn(async () => undefined);
      await inbound.processInboundUpsert(ws, inboundText(a.phone, { extendedTextMessage: { text: "Band karo" } }), reply);
      await inbound.processInboundUpsert(ws, inboundText(b.phone, { conversation: "please stop by tomorrow" }), reply);
      expect((await channel(a.id))!.status).toBe("opted_out");
      expect((await channel(b.id))!.status).toBe("reachable");
      expect(reply).toHaveBeenCalledTimes(1);
    });
  });

  describe("auto-pause (fake Baileys client)", () => {
    it(`${5} failed sends in a day pause the channel and alert admins (not salespeople)`, async () => {
      const socket = fakeSocket({ sendMessage: vi.fn(async () => Promise.reject(new Error("socket hang up"))) });
      const m = connectedManager(socket);
      for (let i = 1; i <= safety.WHATSAPP_FAILURES_TO_PAUSE; i++) {
        await expect(m.sendAction(await proposalSend())).rejects.toThrow("socket hang up");
        expect((await policy()).paused).toBe(i === safety.WHATSAPP_FAILURES_TO_PAUSE);
      }
      expect(await policy()).toEqual({ paused: true, pause_reason: "5 WhatsApp sends failed today (limit 5)." });
      expect((await seed.query(`select recipient_id, title from crm_notifications`)).rows).toEqual([{ recipient_id: admin, title: "WhatsApp sending paused automatically" }]);

      // Paused: every WhatsApp send waits, a human-triggered one included; the socket is not used.
      const ok = fakeSocket();
      await expect(connectedManager(ok).sendAction(await proposalSend())).rejects.toThrow("WhatsApp sending is paused: 5 WhatsApp sends failed today");
      expect((ok as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
      await seed.query(`update crm_whatsapp_outbound_messages set status = 'sent', sent_at = now() - interval '1 day' where status = 'failed'`);
    });

    it("a WhatsApp restriction (reachout lock) pauses the channel and alerts admins", async () => {
      const socket = fakeSocket({ fetchAccountReachoutTimelock: async () => ({ isActive: true }) });
      const err = await connectedManager(socket).sendAction(await proposalSend()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(manager.WhatsAppRestrictedError);
      expect(await policy()).toEqual({ paused: true, pause_reason: "WhatsApp has applied a reachout or new-chat restriction." });
      expect((await seed.query(`select recipient_id from crm_notifications`)).rows).toEqual([{ recipient_id: admin }]);
    });

    it("a logout (terminal disconnect) pauses the channel and alerts admins", async () => {
      const socket = fakeSocket();
      const m = connectedManager(socket) as unknown as { handleConnectionUpdate: (s: unknown, u: object) => Promise<void> };
      const loggedOut = Object.assign(new Error("Connection Failure"), { output: { statusCode: DisconnectReason.loggedOut } });
      await m.handleConnectionUpdate(socket, { connection: "close", lastDisconnect: { error: loggedOut, date: new Date() } });
      expect(await policy()).toEqual({ paused: true, pause_reason: "WhatsApp session ended (Connection Failure); pair the number again before resuming." });
      expect(await one(`select status from crm_whatsapp_connection where workspace_id = $1`, [ws])).toEqual({ status: "reauth_required" });
      expect((await seed.query(`select title from crm_notifications`)).rows).toEqual([{ title: "WhatsApp sending paused automatically" }]);
      await seed.query(`update crm_whatsapp_connection set status = 'connected', desired_state = 'connected' where workspace_id = $1`, [ws]);
    });
  });
});
