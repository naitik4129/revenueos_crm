/**
 * P5: email, WhatsApp, Google Calendar and proposal sending on the PGlite test database.
 * Every provider (email, WhatsApp, Google Calendar) and Supabase Storage is mocked: no network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  sendWhatsApp: vi.fn(),
  createCalendarEvent: vi.fn(),
  storage: { upload: vi.fn(), download: vi.fn(), remove: vi.fn(), from: vi.fn() },
}));

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: {
    auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) },
    storage: { from: mocks.storage.from },
  },
}));
vi.mock("../../src/providers/email.provider.js", () => ({ sendEmail: mocks.sendEmail }));
// No DNS in tests: every domain has a mail server (emailSafety.test.ts covers the MX check).
vi.mock("../../src/services/email-safety.service.js", async (original) => ({
  ...(await original<typeof import("../../src/services/email-safety.service.js")>()),
  domainHasMx: async () => true,
}));
vi.mock("../../src/providers/whatsapp.provider.js", () => ({ sendWhatsApp: mocks.sendWhatsApp }));
vi.mock("../../src/providers/google-calendar.provider.js", async (original) => ({
  ...(await original<typeof import("../../src/providers/google-calendar.provider.js")>()),
  createCalendarEvent: mocks.createCalendarEvent,
}));

describe("integrations (PGlite, providers mocked)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let app: Express;
  let db: typeof import("../../src/db.js");
  let runner: typeof import("../../src/services/automation-runner.js");
  let automation: typeof import("../../src/services/automation.service.js");
  let sam: string;
  let sue: string;
  let w1: string;
  let w2: string;
  let emailTemplate: string;
  let whatsappTemplate: string;
  let n = 0;

  const api = (method: "get" | "post" | "put" | "patch", path: string, body?: object, opts: { ws?: string; as?: string } = {}) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${opts.as ?? sam}`).set("X-Workspace-Id", opts.ws ?? w1);
    return body ? r.send(body) : r;
  };
  const one = async (sql: string, params: unknown[] = []) => (await seed.query(sql, params)).rows[0];
  const newDeal = async (ws = w1) => {
    const phone = `+9198${String(++n).padStart(8, "0")}`;
    const contactId = (await api("post", "/contacts", { firstName: "Asha", email: `asha${n}@acme.com`, phone }, { ws })).body.id as string;
    const dealId = (await api("post", "/deals", { contactId }, { ws })).body.id as string;
    return { contactId, dealId, phone };
  };
  const tick = (dryRun = false) => runner.runAutomationTick({ batchSize: 50, dryRun });

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://crm.example/api/v1/connections/google-calendar/oauth/callback";
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    app = (await import("../../src/app.js")).createApp();
    db = await import("../../src/db.js");
    runner = await import("../../src/services/automation-runner.js");
    automation = await import("../../src/services/automation.service.js");

    const user = async (email: string) => {
      const id = (await seed.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
      await seed.query(`insert into public.revenueos_profiles (id, full_name, email) values ($1, $2, $2)`, [id, email]);
      await seed.query(`insert into crm.profiles (id, role) values ($1, 'salesperson')`, [id]);
      return id;
    };
    sam = await user("sam@x.com");
    sue = await user("sue@x.com");
    w1 = (await seed.query(`insert into crm.workspaces (name, slug) values ('One', 'one') returning id`)).rows[0].id;
    w2 = (await seed.query(`insert into crm.workspaces (name, slug) values ('Two', 'two') returning id`)).rows[0].id;
    await seed.query(`insert into crm.workspace_members (workspace_id, user_id) values ($1, $3), ($2, $3), ($2, $4)`, [w1, w2, sam, sue]);

    emailTemplate = (await api("post", "/templates", { name: "Email", channel: "email", subject: "Hi {{contact.firstName}}", body: "<p>Hello {{contact.firstName}}</p>" })).body.id;
    whatsappTemplate = (await api("post", "/templates", { name: "WA", channel: "whatsapp", body: "<p>Hello {{contact.firstName}}</p>" })).body.id;
    // Sending policies wide open (any hour, no gap): these tests are about the providers, sendPolicy.test.ts about the limits.
    await seed.query(
      `insert into crm.send_policies (workspace_id, channel, daily_cap, ramp_start, min_gap_seconds, max_gap_seconds, window_start, window_end, window_days)
       select w, ch, 2000, 2000, 0, 0, '00:00', '24:00', '{1,2,3,4,5,6,7}' from unnest($1::uuid[]) w, unnest('{email,whatsapp}'::text[]) ch`,
      [[w1, w2]],
    );
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ providerMessageId: "re_123" });
    mocks.sendWhatsApp.mockResolvedValue({ providerMessageId: "wa_123" });
    mocks.storage.upload.mockResolvedValue({ error: null });
    mocks.storage.remove.mockResolvedValue({ error: null });
    mocks.storage.download.mockResolvedValue({ data: new Blob(["%PDF-1.4"]), error: null });
    mocks.storage.from.mockReturnValue(mocks.storage);
  });

  afterAll(async () => {
    await db?.pool.end();
    await seed?.end();
    await testDb?.stop();
  });

  /** A deal enrolled in a one-step email workflow; returns its claimed action. */
  async function claimedEmailAction(): Promise<{ contactId: string; dealId: string; actionId: string; runId: string }> {
    const wf = (await api("post", "/workflows", { name: `W${++n}`, trigger: "manual_enrollment" })).body.id;
    await api("put", `/workflows/${wf}/versions/1/steps`, { steps: [{ order: 0, delayDays: 0, action: "send_email", templateId: emailTemplate, enabled: true }] });
    await api("post", `/workflows/${wf}/versions/1/publish`, {});
    await api("patch", `/workflows/${wf}`, { status: "active" });
    const { contactId, dealId } = await newDeal();
    await api("post", "/runs", { dealId, workflowId: wf });
    const run = await one(`select id from crm.workflow_runs where deal_id = $1`, [dealId]);
    const action = await one(`select id from crm.scheduled_actions where workflow_run_id = $1`, [run.id]);
    expect(await db.withTransaction((c) => automation.claimDueActionIds(c, 50))).toContain(action.id);
    return { contactId, dealId, actionId: action.id, runId: run.id };
  }

  describe("email", () => {
    it("a real worker send goes to the provider and is recorded on the timeline", async () => {
      const { dealId, actionId, contactId } = await claimedEmailAction();
      await runner.processAction(actionId, { batchSize: 50, dryRun: false });
      expect(mocks.sendEmail).toHaveBeenCalledWith(w1, expect.objectContaining({ to: expect.stringMatching(/^asha\d+@acme\.com$/), subject: "Hi Asha" }));
      expect(await one(`select status from crm.scheduled_actions where id = $1`, [actionId])).toEqual({ status: "completed" });
      expect(await one(`select title, detail, contact_id from crm.timeline_events where deal_id = $1 and event_kind = 'email'`, [dealId])).toEqual({
        title: "Email Sent",
        detail: "Provider message id: re_123",
        contact_id: contactId,
      });
    });

    it("a provider outage defers the action without using a retry", async () => {
      const { ProviderDeferredError } = await import("../../src/providers/provider-errors.js");
      mocks.sendEmail.mockRejectedValueOnce(new ProviderDeferredError("Email sending is disabled for this workspace."));
      const { actionId } = await claimedEmailAction();
      await runner.processAction(actionId, { batchSize: 50, dryRun: false });
      expect(await one(`select status, attempt_count from crm.scheduled_actions where id = $1`, [actionId])).toEqual({ status: "pending", attempt_count: 0 });
    });
  });

  describe("a DNC contact blocks every send", () => {
    it("worker email", async () => {
      const { contactId, actionId } = await claimedEmailAction();
      await api("post", `/contacts/${contactId}/dnc`, { reason: "Stop" });
      await runner.processAction(actionId, { batchSize: 50, dryRun: false });
      expect(mocks.sendEmail).not.toHaveBeenCalled();
      expect(await one(`select status from crm.scheduled_actions where id = $1`, [actionId])).toEqual({ status: "skipped" });
    });

    it("proposal send (409) and its queued WhatsApp", async () => {
      const { dealId, contactId } = await newDeal();
      const proposalId = (await api("post", "/proposals", { dealId, title: "Retainer" })).body.id;
      await api("post", `/proposals/${proposalId}/document`).attach("document", Buffer.from("%PDF"), { filename: "p.pdf", contentType: "application/pdf" });
      // Queued for WhatsApp first, then the contact goes DNC before the worker runs.
      expect((await api("post", `/proposals/${proposalId}/send`, { whatsappTemplateId: whatsappTemplate })).body.whatsappSendStatus).toBe("queued");
      await api("post", `/contacts/${contactId}/dnc`, { reason: "Stop" });

      const again = await api("post", `/proposals/${proposalId}/send`, { emailTemplateId: emailTemplate });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("do_not_contact");

      await tick();
      expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
      expect(mocks.sendEmail).not.toHaveBeenCalled();
      expect(await one(`select whatsapp_send_status, whatsapp_send_error from crm.proposals where id = $1`, [proposalId])).toEqual({
        whatsapp_send_status: "failed",
        whatsapp_send_error: "Contact is Do Not Contact.",
      });
    });

    it("WhatsApp claim refuses a DNC contact even when the send is already queued", async () => {
      const { claimOutboundSend } = await import("../../src/providers/baileys.manager.js");
      await seed.query(`insert into crm.whatsapp_connection (workspace_id, enabled, status) values ($1, true, 'connected') on conflict (workspace_id) do update set enabled = true, status = 'connected'`, [w1]);
      const { dealId, contactId, phone } = await newDeal();
      const proposalId = (await api("post", "/proposals", { dealId, title: "P" })).body.id;
      await seed.query(`update crm.proposals set whatsapp_send_status = 'sending' where id = $1`, [proposalId]);
      await api("post", `/contacts/${contactId}/dnc`, { reason: "Stop" });

      const claim = db.withTransaction((c) => claimOutboundSend(c, w1, { source: { type: "proposal", id: proposalId }, phoneE164: phone, preparedMessageId: "m1" }, fakeSocket(), true));
      await expect(claim).rejects.toThrow("Contact is Do Not Contact.");
    });
  });

  const fakeSocket = () =>
    ({
      fetchAccountReachoutTimelock: async () => ({ isActive: false }),
      fetchNewChatMessageCap: async () => null,
      onWhatsApp: async () => [{ exists: true, jid: "x@s.whatsapp.net" }],
    }) as unknown as import("../../src/providers/baileys.manager.js").ClaimSocket;

  it("the WhatsApp daily cap is counted per workspace", async () => {
    const { claimOutboundSend } = await import("../../src/providers/baileys.manager.js");
    for (const ws of [w1, w2]) {
      await seed.query(
        `insert into crm.whatsapp_connection (workspace_id, enabled, status, daily_cap) values ($1, true, 'connected', 1)
         on conflict (workspace_id) do update set enabled = true, status = 'connected', daily_cap = 1`,
        [ws],
      );
    }
    const sendable = async (ws: string) => {
      const { dealId, phone } = await newDeal(ws);
      const proposalId = (await api("post", "/proposals", { dealId, title: "P" }, { ws })).body.id as string;
      await seed.query(`update crm.proposals set whatsapp_send_status = 'sending' where id = $1`, [proposalId]);
      return { proposalId, phone };
    };
    // Workspace 1 already sent one message today.
    const sent = await sendable(w1);
    await seed.query(
      `insert into crm.whatsapp_outbound_messages (workspace_id, contact_id, proposal_id, message_id, remote_jid, status, sent_at)
       select $1, d.contact_id, p.id, 'sent-1', 'x@s.whatsapp.net', 'sent', now() from crm.proposals p join crm.deals d on d.id = p.deal_id where p.id = $2`,
      [w1, sent.proposalId],
    );

    const next1 = await sendable(w1);
    const claim1 = db.withTransaction((c) => claimOutboundSend(c, w1, { source: { type: "proposal", id: next1.proposalId }, phoneE164: next1.phone, preparedMessageId: "m2" }, fakeSocket(), true));
    await expect(claim1).rejects.toThrow("daily cap");

    const next2 = await sendable(w2);
    const claim2 = await db.withTransaction((c) => claimOutboundSend(c, w2, { source: { type: "proposal", id: next2.proposalId }, phoneE164: next2.phone, preparedMessageId: "m3" }, fakeSocket(), true));
    expect(claim2).toMatchObject({ kind: "send", messageId: "m3" });
  });

  it("an inbound WhatsApp reply stops automation on that contact's deals only (no body stored)", async () => {
    const { processInboundUpsert } = await import("../../src/services/whatsapp-inbound.service.js");
    const { contactId, dealId, runId } = await claimedEmailAction();
    const phone = (await one(`select phone_e164 from crm.contacts where id = $1`, [contactId])).phone_e164 as string;
    // Same number in another workspace must not be touched.
    const other = (await api("post", "/contacts", { firstName: "Other", phone }, { ws: w2 })).body.id;
    const otherDeal = (await api("post", "/deals", { contactId: other }, { ws: w2 })).body.id;
    await seed.query(`update crm.deals set automation_mode = 'active' where id = $1`, [otherDeal]);

    await processInboundUpsert(w1, {
      type: "notify",
      messages: [{ key: { id: "in-1", remoteJid: `${phone.slice(1)}@s.whatsapp.net`, fromMe: false }, message: { conversation: "Call me" }, messageTimestamp: Math.floor(Date.now() / 1000) }] as never,
    });

    // A reply means "engaged", but this contact (with a deal) is already "qualified": lifecycle only moves forward.
    expect((await api("get", `/deals/${dealId}`)).body).toMatchObject({ automationMode: "manual", responseState: "responded", lifecycleStage: "qualified" });
    expect(await one(`select status from crm.workflow_runs where id = $1`, [runId])).toEqual({ status: "cancelled" });
    expect(await one(`select disposition, contact_id, message_type from crm.whatsapp_inbound_events where message_id = 'in-1'`)).toEqual({
      disposition: "matched",
      contact_id: contactId,
      message_type: "conversation",
    });
    expect(JSON.stringify(await one(`select * from crm.whatsapp_inbound_events where message_id = 'in-1'`))).not.toContain("Call me");
    expect((await api("get", `/deals/${otherDeal}`, undefined, { ws: w2 })).body.automationMode).toBe("active");
  });

  it("a Google Calendar failure does not fail the meeting", async () => {
    const { encryptText } = await import("../../src/security/encryption.js");
    const token = encryptText("refresh-token", "integration:google_calendar:refresh_token");
    await seed.query(
      `insert into crm.google_calendar_connection (workspace_id, status, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag)
       values ($1, 'connected', $2, $3, $4)
       on conflict (workspace_id) do update set status = 'connected', refresh_token_ciphertext = $2, refresh_token_iv = $3, refresh_token_tag = $4`,
      [w1, token.ciphertext, token.iv, token.tag],
    );
    mocks.createCalendarEvent.mockRejectedValueOnce(new Error("Google is down"));
    const { dealId } = await newDeal();
    const res = await api("post", "/meetings", { dealId, title: "Discovery", at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "scheduled", calendarSyncStatus: "failed", calendarSyncError: "Google is down" });
    expect(mocks.createCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it("proposal: upload to crm-proposal-documents, email now, WhatsApp queued then sent by the worker", async () => {
    const { dealId } = await newDeal();
    const proposalId = (await api("post", "/proposals", { dealId, title: "Retainer" })).body.id;
    expect((await api("post", `/proposals/${proposalId}/send`, { emailTemplateId: emailTemplate })).status).toBe(400);

    const uploaded = await api("post", `/proposals/${proposalId}/document`).attach("document", Buffer.from("%PDF-1.4"), { filename: "offer.pdf", contentType: "application/pdf" });
    expect(uploaded.body).toMatchObject({ status: "uploaded", fileName: "offer.pdf", documentMimeType: "application/pdf" });
    expect(mocks.storage.from).toHaveBeenCalledWith("crm-proposal-documents");
    expect(mocks.storage.upload.mock.calls[0]![0]).toMatch(new RegExp(`^${w1}/${dealId}/.+-offer\\.pdf$`));

    const sent = await api("post", `/proposals/${proposalId}/send`, { emailTemplateId: emailTemplate, whatsappTemplateId: whatsappTemplate });
    expect(sent.body).toMatchObject({ status: "sent", emailSendStatus: "sent", whatsappSendStatus: "queued" });
    expect(mocks.sendEmail).toHaveBeenCalledWith(w1, expect.objectContaining({ attachments: [expect.objectContaining({ filename: "offer.pdf" })] }));
    expect((await api("get", `/deals/${dealId}`)).body.stage).toBe("proposal_decision_pending");

    await tick();
    expect(mocks.sendWhatsApp).toHaveBeenCalledWith(
      w1,
      expect.objectContaining({ source: { type: "proposal", id: proposalId }, attachment: expect.objectContaining({ bucket: "crm-proposal-documents" }) }),
    );
    expect((await api("get", `/proposals/${proposalId}`)).body.whatsappSendStatus).toBe("sent");
  });

  it("connections are per workspace: rows created on first use, settings never cross workspaces", async () => {
    expect(await one(`select count(*)::int n from crm.integration_connections where workspace_id = $1`, [w2])).toEqual({ n: 0 });
    expect((await api("get", "/connections/email", undefined, { ws: w2 })).body).toMatchObject({ provider: null, source: "unconfigured" });
    expect(await one(`select count(*)::int n from crm.integration_connections where workspace_id = $1`, [w2])).toEqual({ n: 1 });

    const saved = await api("put", "/connections/email", { provider: "resend", enabled: true, senderName: "One", senderAddress: "one@x.com", resendApiKey: "re_secret" });
    expect(saved.body).toMatchObject({ provider: "resend", resendApiKeyConfigured: true });
    expect(JSON.stringify(saved.body)).not.toContain("re_secret");
    expect((await api("get", "/connections/email", undefined, { ws: w2 })).body.provider).toBeNull();

    // Sue is a member of workspace 2 only.
    expect((await api("get", "/connections/email", undefined, { ws: w1, as: sue })).status).toBe(403);
    expect((await api("get", "/connections/whatsapp/settings", undefined, { ws: w2, as: sue })).status).toBe(200);
  });
});
