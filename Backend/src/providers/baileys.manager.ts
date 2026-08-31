import makeWASocket, {
  DisconnectReason,
  generateMessageIDV2,
  proto,
  type AnyMessageContent,
  type ConnectionState,
  type WASocket,
} from "baileys";
import pino from "pino";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "../db.js";
import { phoneE164ToJid } from "../domain/phone.js";
import { decryptBytes, encryptBytes } from "../security/encryption.js";
import { clearBaileysAuthState, loadBaileysAuthState } from "./baileys-auth.store.js";
import { PermanentProviderError, ProviderDeferredError } from "./provider-errors.js";
import { processInboundUpsert } from "../services/whatsapp-inbound.service.js";
import { isOutboundRestricted, isTerminalDisconnect, randomSpacingMs, reconnectDelayMs } from "../domain/baileys-policy.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

export interface WhatsAppAttachment {
  storagePath: string;
  fileName: string;
  mimeType: string;
  bucket: string;
}

/**
 * What this send is for. `scheduled_action` is the original workflow-driven
 * path (idempotency/eligibility keyed off a real `scheduled_actions` row).
 * `proposal` is a human-initiated "Send" click with no scheduled action
 * behind it (a proposal needs a per-send, user-chosen template, unlike a
 * workflow step whose template is fixed at definition time) — its outbound
 * row is keyed off `whatsapp_outbound_messages.proposal_id` instead. Every
 * shared safety mechanism below (emergency switch, daily cap, spacing,
 * connection checks) stays computed generically across the whole table
 * regardless of which source a row came from.
 */
export type WhatsAppSendSource = { type: "scheduled_action"; id: string } | { type: "proposal"; id: string };

function sourceColumn(source: WhatsAppSendSource): "scheduled_action_id" | "proposal_id" {
  return source.type === "scheduled_action" ? "scheduled_action_id" : "proposal_id";
}

const WORKER_LOCK_ID = 8_726_149_211;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function disconnectCode(update: Partial<ConnectionState>) {
  const error = update.lastDisconnect?.error as Error & { output?: { statusCode?: number }; statusCode?: number };
  return error?.output?.statusCode ?? error?.statusCode;
}

function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, nested) => (nested instanceof Date ? nested.toISOString() : nested))) as unknown;
}

interface ConnectionControl {
  enabled: boolean;
  desired_state: "connected" | "disconnected" | "restart";
  command_version: string;
  status: string;
  daily_cap: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  reachout_lock: { isActive?: boolean } | null;
  new_chat_cap: { capping_status?: string; ote_status?: string } | null;
}

interface OutboundRow {
  message_id: string;
  remote_jid: string;
  status: "prepared" | "sent" | "failed";
}

export class BaileysManager {
  private socket: WASocket | null = null;
  private lockClient: PoolClient | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private qrExpiryTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private commandVersion = "-1";
  private intentionalClose = false;
  private connected = false;
  private opening = false;
  private sendTail: Promise<unknown> = Promise.resolve();
  private credsSaveTail: Promise<void> = Promise.resolve();
  private readonly logger = pino({
    level: process.env.NODE_ENV === "production" ? "warn" : "info",
    redact: ["qr", "auth", "key", "msg", "message", "*.key", "*.message"],
  });

  async start() {
    this.lockClient = await pool.connect();
    const lock = await this.lockClient.query<{ locked: boolean }>(`select pg_try_advisory_lock($1::bigint) as locked`, [WORKER_LOCK_ID]);
    if (!lock.rows[0]?.locked) {
      this.lockClient.release();
      this.lockClient = null;
      throw new Error("Another automation worker owns the shared WhatsApp session.");
    }
    await this.syncControl();
    this.heartbeatTimer = setInterval(() => {
      void this.syncControl().catch((error) => this.logger.error({ err: error }, "WhatsApp control sync failed"));
    }, 10_000);
  }

  async stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.qrExpiryTimer) clearTimeout(this.qrExpiryTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.intentionalClose = true;
    this.socket?.end(new Error("Worker shutting down"));
    this.socket = null;
    this.connected = false;
    if (this.lockClient) {
      await this.lockClient.query(`select pg_advisory_unlock($1::bigint)`, [WORKER_LOCK_ID]).catch(() => undefined);
      this.lockClient.release();
      this.lockClient = null;
    }
  }

  async syncControl() {
    const result = await pool.query<ConnectionControl>(`select * from public.whatsapp_connection where id = true`);
    const control = result.rows[0]!;
    await pool.query(`update public.whatsapp_connection set worker_heartbeat_at = now() where id = true`);
    const isNewCommand = control.command_version !== this.commandVersion;
    this.commandVersion = control.command_version;
    if (control.desired_state === "disconnected") {
      if (this.socket || isNewCommand) await this.logout();
      return;
    }
    if (control.desired_state === "restart" && isNewCommand) {
      await pool.query(`update public.whatsapp_connection set desired_state = 'connected', status = 'connecting' where id = true`);
      await this.closeSocket("Administrator requested restart");
      await this.openSocket();
      return;
    }
    if (!this.socket && !this.reconnectTimer) await this.openSocket();
  }

  private async openSocket() {
    if (this.socket || this.opening) return;
    this.opening = true;
    try {
      await this.openSocketUnguarded();
    } finally {
      this.opening = false;
    }
  }

  private async openSocketUnguarded() {
    this.intentionalClose = false;
    await pool.query(`update public.whatsapp_connection set status = 'connecting', last_error = null where id = true`);
    const { state, saveCreds } = await loadBaileysAuthState();
    const socket = makeWASocket({
      auth: state,
      logger: this.logger,
      browser: ["Northbeam CRM", "Chrome", "1.0.0"],
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: false,
      emitOwnEvents: false,
      generateHighQualityLinkPreview: false,
      shouldIgnoreJid: (jid) =>
        jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter"),
      getMessage: async (key) => {
        if (!key.id || !key.remoteJid) return undefined;
        const result = await pool.query<{
          payload_ciphertext: Buffer;
          payload_iv: Buffer;
          payload_tag: Buffer;
          key_version: number;
        }>(
          `select payload_ciphertext, payload_iv, payload_tag, key_version
             from public.whatsapp_outbound_messages
            where message_id = $1 and remote_jid = $2 and payload_ciphertext is not null`,
          [key.id, key.remoteJid],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        const plaintext = decryptBytes(
          { ciphertext: row.payload_ciphertext, iv: row.payload_iv, tag: row.payload_tag, keyVersion: row.key_version },
          `whatsapp:outbound:${key.id}`,
        ).toString("utf8");
        return proto.Message.fromObject(JSON.parse(plaintext));
      },
    });
    this.socket = socket;
    socket.ev.on("creds.update", (update) => {
      if (this.socket !== socket) return;
      Object.assign(state.creds, update);
      this.credsSaveTail = this.credsSaveTail
        .then(() => saveCreds())
        .catch((error) => this.logger.error({ err: error }, "Failed to persist WhatsApp credentials"));
    });
    socket.ev.on("connection.update", (update) => void this.handleConnectionUpdate(socket, update));
    socket.ev.on("messages.upsert", (event) => {
      if (this.socket !== socket) return;
      void processInboundUpsert(event).catch((error) => this.logger.error({ err: error }, "Inbound WhatsApp processing failed"));
    });
  }

  private async handleConnectionUpdate(source: WASocket, update: Partial<ConnectionState>) {
    if (this.socket !== source) return;
    if (update.qr) await this.storeQr(update.qr);
    if (update.reachoutTimeLock !== undefined) {
      await pool.query(`update public.whatsapp_connection set reachout_lock = $1 where id = true`, [jsonSafe(update.reachoutTimeLock)]);
    }
    if (update.connection === "open") {
      this.connected = true;
      this.reconnectAttempt = 0;
      const user = this.socket?.user;
      await pool.query(
        `update public.whatsapp_connection
            set status = 'connected', connected_jid = $1, connected_phone = $2, display_name = $3,
                last_connected_at = now(), last_error = null,
                qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null
          where id = true`,
        [user?.id ?? null, user?.id?.split("@", 1)[0]?.split(":", 1)[0] ?? null, user?.name ?? null],
      );
      const cap = await this.socket?.fetchNewChatMessageCap().catch(() => undefined);
      if (cap) await pool.query(`update public.whatsapp_connection set new_chat_cap = $1 where id = true`, [jsonSafe(cap)]);
      return;
    }
    if (update.connection !== "close") return;
    this.connected = false;
    this.socket = null;
    const code = disconnectCode(update);
    const message = update.lastDisconnect?.error?.message ?? "WhatsApp connection closed.";
    if (this.intentionalClose) return;
    if (isTerminalDisconnect(code)) {
      await clearBaileysAuthState();
      await pool.query(
        `update public.whatsapp_connection
            set status = 'reauth_required', desired_state = 'disconnected', last_error = $1, last_disconnected_at = now(),
                qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null
          where id = true`,
        [message],
      );
      return;
    }
    await pool.query(
      `update public.whatsapp_connection set status = 'reconnecting', last_error = $1, last_disconnected_at = now() where id = true`,
      [message],
    );
    this.scheduleReconnect(code === DisconnectReason.restartRequired ? 0 : undefined);
  }

  private scheduleReconnect(forcedDelay?: number) {
    if (this.reconnectTimer) return;
    const delay = forcedDelay ?? reconnectDelayMs(this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket().catch((error) => {
        this.logger.error({ err: error }, "WhatsApp reconnect failed");
        this.scheduleReconnect();
      });
    }, delay);
  }

  private async storeQr(qr: string) {
    const encrypted = encryptBytes(Buffer.from(qr, "utf8"), "whatsapp:pairing-qr");
    const expiresAt = new Date(Date.now() + 90_000);
    await pool.query(
      `update public.whatsapp_connection
          set status = 'qr_ready', qr_ciphertext = $1, qr_iv = $2, qr_tag = $3, qr_key_version = $4, qr_expires_at = $5
        where id = true`,
      [encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion, expiresAt.toISOString()],
    );
    if (this.qrExpiryTimer) clearTimeout(this.qrExpiryTimer);
    this.qrExpiryTimer = setTimeout(() => {
      void pool.query(
        `update public.whatsapp_connection
            set qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null,
                status = case when status = 'qr_ready' then 'connecting' else status end
          where id = true and qr_expires_at <= now()`,
      );
    }, 91_000);
  }

  private async closeSocket(reason: string) {
    this.intentionalClose = true;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    socket?.end(new Error(reason));
    this.intentionalClose = false;
  }

  private async logout() {
    this.intentionalClose = true;
    if (this.socket) await this.socket.logout().catch(() => undefined);
    this.socket = null;
    this.connected = false;
    await clearBaileysAuthState();
    await pool.query(
      `update public.whatsapp_connection
          set status = 'disconnected', connected_jid = null, connected_phone = null, display_name = null,
              last_error = null, reachout_lock = null, new_chat_cap = null, last_disconnected_at = now(),
              qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null
        where id = true`,
    );
    this.intentionalClose = false;
  }

  sendAction(input: {
    source: WhatsAppSendSource;
    phoneE164: string;
    body: string;
    attachment?: WhatsAppAttachment;
  }): Promise<{ providerMessageId: string }> {
    const task = this.sendTail.then(() => this.performSend(input));
    this.sendTail = task.catch(() => undefined);
    return task;
  }

  private async performSend(input: { source: WhatsAppSendSource; phoneE164: string; body: string; attachment?: WhatsAppAttachment }) {
    if (!this.socket || !this.connected) throw new ProviderDeferredError("WhatsApp is disconnected or awaiting QR pairing.");
    const jid = phoneE164ToJid(input.phoneE164);
    const column = sourceColumn(input.source);
    const sourceId = input.source.id;
    const proposedMessageId = generateMessageIDV2(this.socket.user?.id);
    const prepared = await withTransaction(async (db) => {
      await db.query(
        `insert into public.whatsapp_outbound_messages (${column}, message_id, remote_jid)
         values ($1,$2,$3)
         on conflict (${column}) do nothing`,
        [sourceId, proposedMessageId, jid],
      );
      const result = await db.query<OutboundRow>(
        `select message_id, remote_jid, status from public.whatsapp_outbound_messages where ${column} = $1`,
        [sourceId],
      );
      const row = result.rows[0]!;
      // Text-only placeholder even when this send carries an attachment: if a
      // retry-receipt request lands in the narrow window between this claim
      // and the real send below, it would be served this placeholder instead
      // of the actual media message. Accepted minor edge case, not fixed here.
      const retryPayload = proto.Message.toObject(proto.Message.fromObject({ conversation: input.body }));
      const encrypted = encryptBytes(
        Buffer.from(JSON.stringify(retryPayload), "utf8"),
        `whatsapp:outbound:${row.message_id}`,
      );
      await db.query(
        `update public.whatsapp_outbound_messages
            set payload_ciphertext = $2, payload_iv = $3, payload_tag = $4, key_version = $5, updated_at = now()
          where ${column} = $1 and payload_ciphertext is null`,
        [sourceId, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion],
      );
      return row;
    });
    if (prepared.remote_jid !== jid) {
      throw new PermanentProviderError("The lead phone changed after this WhatsApp action was prepared; the action was not redirected.");
    }
    // Claim the send: validate the emergency switch, restrictions, eligibility, and
    // daily cap, and compute the send-spacing wait — all inside a short transaction
    // that releases its row locks immediately, instead of holding them across the
    // spacing sleep below (which would otherwise block the admin's disable toggle
    // for up to max_delay_seconds).
    const claim = await withTransaction(async (db) => {
      await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.phoneE164]);
      const state = await db.query<ConnectionControl>(`select * from public.whatsapp_connection where id = true for update`);
      const control = state.rows[0]!;
      if (!control.enabled) throw new ProviderDeferredError("WhatsApp outbound is disabled by the emergency switch.");
      if (control.status !== "connected" || !this.socket || !this.connected) throw new ProviderDeferredError("WhatsApp is not connected.");
      const [liveReachout, liveCap] = await Promise.all([
        this.socket.fetchAccountReachoutTimelock().catch(() => control.reachout_lock),
        this.socket.fetchNewChatMessageCap().catch(() => control.new_chat_cap),
      ]);
      await db.query(`update public.whatsapp_connection set reachout_lock = $1, new_chat_cap = $2 where id = true`, [
        jsonSafe(liveReachout),
        jsonSafe(liveCap),
      ]);
      if (isOutboundRestricted(liveReachout, liveCap))
        throw new ProviderDeferredError("WhatsApp has applied a reachout or new-chat restriction.", 300_000);
      const eligible =
        input.source.type === "scheduled_action"
          ? await db.query<{ phone_e164: string | null }>(
              `select l.phone_e164
                 from public.scheduled_actions a
                 join public.leads l on l.id = a.lead_id
                 join public.workflow_runs r on r.id = a.workflow_run_id
                where a.id = $1 and a.status = 'executing'
                  and l.lifecycle_state = 'active' and l.automation_mode not in ('manual','paused','stopped')
                  and r.status in ('running','waiting')
                for update of a, l, r`,
              [sourceId],
            )
          : await db.query<{ phone_e164: string | null }>(
              // A human clicked "Send" on this proposal — no automation_mode
              // gate (that gate restrains the automation engine, not a
              // person), only the DNC safety check every customer-facing
              // action must honor.
              `select l.phone_e164
                 from public.proposals p
                 join public.leads l on l.id = p.lead_id
                where p.id = $1 and p.whatsapp_send_status = 'sending'
                  and l.lifecycle_state != 'do_not_contact'
                for update of p, l`,
              [sourceId],
            );
      if (eligible.rows[0]?.phone_e164 !== input.phoneE164) {
        throw new PermanentProviderError("The lead is no longer eligible for this WhatsApp action.");
      }
      const daily = await db.query<{ count: string }>(
        `select count(*)::text as count from public.whatsapp_outbound_messages
          where status = 'sent'
            and sent_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`,
      );
      if (Number(daily.rows[0]?.count ?? 0) >= control.daily_cap) {
        throw new ProviderDeferredError("The Asia/Kolkata WhatsApp daily cap has been reached.", 300_000);
      }
      const existing = await db.query<OutboundRow>(
        `select message_id, remote_jid, status from public.whatsapp_outbound_messages where ${column} = $1`,
        [sourceId],
      );
      if (existing.rows[0]?.status === "sent") {
        return { alreadySent: true as const, messageId: existing.rows[0].message_id, waitMs: 0 };
      }
      const messageId = existing.rows[0]?.message_id ?? prepared.message_id;
      const registered = await this.socket.onWhatsApp(input.phoneE164.slice(1));
      if (!registered?.some((entry) => entry.exists)) {
        await db.query(
          `update public.whatsapp_outbound_messages set status = 'failed', last_error = 'Recipient is not on WhatsApp' where ${column} = $1`,
          [sourceId],
        );
        const leadIdSource = input.source.type === "scheduled_action" ? "public.scheduled_actions" : "public.proposals";
        await db.query(
          `insert into public.lead_contact_channels (lead_id, channel, status, reason, updated_by_name)
           select lead_id, 'whatsapp', 'invalid', 'Number is not registered on WhatsApp', 'Automation'
             from ${leadIdSource} where id = $1
           on conflict (lead_id, channel) do update
             set status = 'invalid', reason = excluded.reason, updated_at = now(), updated_by = null, updated_by_name = 'Automation'`,
          [sourceId],
        );
        throw new PermanentProviderError("Recipient is not registered on WhatsApp.");
      }
      const latest = await db.query<{ sent_at: Date | null }>(
        `select max(sent_at) as sent_at from public.whatsapp_outbound_messages where status = 'sent'`,
      );
      const spacing = randomSpacingMs(control.min_delay_seconds, control.max_delay_seconds);
      const elapsed = latest.rows[0]?.sent_at ? Date.now() - latest.rows[0].sent_at.getTime() : spacing;
      return { alreadySent: false as const, messageId, waitMs: elapsed < spacing ? spacing - elapsed : 0 };
    });
    if (claim.alreadySent) return { providerMessageId: claim.messageId };
    if (claim.waitMs > 0) await sleep(claim.waitMs);

    // Re-check the emergency switch and live connection state after the spacing
    // sleep: the row lock above was released before sleeping, so a disable made
    // during the wait must still stop this send from going out.
    const recheck = await pool.query<{ enabled: boolean; status: string }>(
      `select enabled, status from public.whatsapp_connection where id = true`,
    );
    if (!recheck.rows[0]?.enabled) throw new ProviderDeferredError("WhatsApp outbound is disabled by the emergency switch.");
    if (recheck.rows[0].status !== "connected" || !this.socket || !this.connected) {
      throw new ProviderDeferredError("WhatsApp is not connected.");
    }

    let messageContent: AnyMessageContent = { text: input.body };
    if (input.attachment) {
      const { data, error } = await supabaseAdmin.storage
        .from(input.attachment.bucket)
        .download(input.attachment.storagePath);
      if (error || !data) throw new Error(`Failed to download WhatsApp attachment: ${error?.message ?? "no data"}`);
      const buffer = Buffer.from(await data.arrayBuffer());
      messageContent = input.attachment.mimeType.startsWith("image/")
        ? { image: buffer, caption: input.body }
        : { document: buffer, fileName: input.attachment.fileName, mimetype: input.attachment.mimeType, caption: input.body };
    }

    return withTransaction(async (db) => {
      const sent = await this.socket!.sendMessage(jid, messageContent, { messageId: claim.messageId });
      if (!sent?.message) throw new Error("Baileys returned no message payload.");
      const payload = proto.Message.toObject(proto.Message.fromObject(sent.message));
      const encrypted = encryptBytes(Buffer.from(JSON.stringify(payload), "utf8"), `whatsapp:outbound:${claim.messageId}`);
      await db.query(
        `update public.whatsapp_outbound_messages
            set status = 'sent', payload_ciphertext = $2, payload_iv = $3, payload_tag = $4,
                key_version = $5, sent_at = now(), last_error = null, updated_at = now()
          where ${column} = $1`,
        [sourceId, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion],
      );
      return { providerMessageId: claim.messageId };
    });
  }
}

export const baileysManager = new BaileysManager();
