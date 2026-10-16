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
import { sendBlockReason } from "../services/consent.service.js";

export interface WhatsAppAttachment {
  storagePath: string;
  fileName: string;
  mimeType: string;
  bucket: string;
}

/**
 * What this send is for. `scheduled_action` is the original workflow-driven
 * path (idempotency/eligibility keyed off a real `scheduled_actions` row).
 * `proposal` and `meeting` are human-initiated sends with no scheduled
 * action behind them (each needs a template resolved at send time rather
 * than fixed at workflow-definition time) — their outbound rows are keyed
 * off `whatsapp_outbound_messages.proposal_id`/`meeting_id` instead. Every
 * shared safety mechanism below (emergency switch, daily cap, spacing,
 * connection checks) stays computed generically across the whole table
 * regardless of which source a row came from.
 */
export type WhatsAppSendSource = { type: "scheduled_action"; id: string } | { type: "proposal"; id: string } | { type: "meeting"; id: string };

function sourceColumn(source: WhatsAppSendSource): "scheduled_action_id" | "proposal_id" | "meeting_id" {
  if (source.type === "scheduled_action") return "scheduled_action_id";
  if (source.type === "proposal") return "proposal_id";
  return "meeting_id";
}

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

/**
 * One instance per workspace (see baileys-registry.ts) — each workspace owns
 * its own WhatsApp number/session, its own Postgres advisory lock (keyed off
 * workspaceId rather than one shared constant), and its own control-plane
 * row in whatsapp_connection (workspace_id is now that table's primary key;
 * see 015_workspaces.sql). Nothing here is shared across workspaces: the
 * daily cap, send spacing, and outbound/inbound message queries below are
 * all scoped to `this.workspaceId`.
 */
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
  private readonly logger: pino.Logger;

  constructor(private readonly workspaceId: string) {
    this.logger = pino({
      level: process.env.NODE_ENV === "production" ? "warn" : "info",
      redact: ["qr", "auth", "key", "msg", "message", "*.key", "*.message"],
    }).child({ workspaceId });
  }

  async start() {
    this.lockClient = await pool.connect();
    // Salt 1 keeps this "one worker owns this workspace's WhatsApp session"
    // lock in a separate namespace from performSend's per-phone dedup lock
    // below (salt 0) — both hash an arbitrary string into a bigint via
    // hashtextextended, so two different salts guarantee they can never
    // collide even if a phone number string and a workspace UUID string
    // happened to hash to the same value.
    const lock = await this.lockClient.query<{ locked: boolean }>(
      `select pg_try_advisory_lock(hashtextextended($1, 1)) as locked`,
      [this.workspaceId],
    );
    if (!lock.rows[0]?.locked) {
      this.lockClient.release();
      this.lockClient = null;
      throw new Error(`Another automation worker already owns this workspace's WhatsApp session (workspace ${this.workspaceId}).`);
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
      await this.lockClient.query(`select pg_advisory_unlock(hashtextextended($1, 1))`, [this.workspaceId]).catch(() => undefined);
      this.lockClient.release();
      this.lockClient = null;
    }
  }

  async syncControl() {
    const result = await pool.query<ConnectionControl>(`select * from crm.whatsapp_connection where workspace_id = $1`, [this.workspaceId]);
    const control = result.rows[0]!;
    await pool.query(`update crm.whatsapp_connection set worker_heartbeat_at = now() where workspace_id = $1`, [this.workspaceId]);
    const isNewCommand = control.command_version !== this.commandVersion;
    this.commandVersion = control.command_version;
    if (control.desired_state === "disconnected") {
      if (this.socket || isNewCommand) await this.logout();
      return;
    }
    if (control.desired_state === "restart" && isNewCommand) {
      await pool.query(`update crm.whatsapp_connection set desired_state = 'connected', status = 'connecting' where workspace_id = $1`, [this.workspaceId]);
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
    await pool.query(`update crm.whatsapp_connection set status = 'connecting', last_error = null where workspace_id = $1`, [this.workspaceId]);
    const { state, saveCreds } = await loadBaileysAuthState(this.workspaceId);
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
             from crm.whatsapp_outbound_messages
            where workspace_id = $1 and message_id = $2 and remote_jid = $3 and payload_ciphertext is not null`,
          [this.workspaceId, key.id, key.remoteJid],
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
      void processInboundUpsert(this.workspaceId, event).catch((error) => this.logger.error({ err: error }, "Inbound WhatsApp processing failed"));
    });
  }

  private async handleConnectionUpdate(source: WASocket, update: Partial<ConnectionState>) {
    if (this.socket !== source) return;
    if (update.qr) await this.storeQr(update.qr);
    if (update.reachoutTimeLock !== undefined) {
      await pool.query(`update crm.whatsapp_connection set reachout_lock = $1 where workspace_id = $2`, [jsonSafe(update.reachoutTimeLock), this.workspaceId]);
    }
    if (update.connection === "open") {
      this.connected = true;
      this.reconnectAttempt = 0;
      const user = this.socket?.user;
      await pool.query(
        `update crm.whatsapp_connection
            set status = 'connected', connected_jid = $1, connected_phone = $2, display_name = $3,
                last_connected_at = now(), last_error = null,
                qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null
          where workspace_id = $4`,
        [user?.id ?? null, user?.id?.split("@", 1)[0]?.split(":", 1)[0] ?? null, user?.name ?? null, this.workspaceId],
      );
      const cap = await this.socket?.fetchNewChatMessageCap().catch(() => undefined);
      if (cap) await pool.query(`update crm.whatsapp_connection set new_chat_cap = $1 where workspace_id = $2`, [jsonSafe(cap), this.workspaceId]);
      return;
    }
    if (update.connection !== "close") return;
    this.connected = false;
    this.socket = null;
    const code = disconnectCode(update);
    const message = update.lastDisconnect?.error?.message ?? "WhatsApp connection closed.";
    if (this.intentionalClose) return;
    if (isTerminalDisconnect(code)) {
      await clearBaileysAuthState(this.workspaceId);
      await pool.query(
        `update crm.whatsapp_connection
            set status = 'reauth_required', desired_state = 'disconnected', last_error = $1, last_disconnected_at = now(),
                qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null
          where workspace_id = $2`,
        [message, this.workspaceId],
      );
      return;
    }
    await pool.query(
      `update crm.whatsapp_connection set status = 'reconnecting', last_error = $1, last_disconnected_at = now() where workspace_id = $2`,
      [message, this.workspaceId],
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
    // Not workspace-namespaced — see baileys-auth.store.ts's comment: AAD
    // must stay a fixed string so it matches whatever pre-existing rows
    // were encrypted under before per-workspace scoping shipped.
    const encrypted = encryptBytes(Buffer.from(qr, "utf8"), "whatsapp:pairing-qr");
    const expiresAt = new Date(Date.now() + 90_000);
    await pool.query(
      `update crm.whatsapp_connection
          set status = 'qr_ready', qr_ciphertext = $1, qr_iv = $2, qr_tag = $3, qr_key_version = $4, qr_expires_at = $5
        where workspace_id = $6`,
      [encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion, expiresAt.toISOString(), this.workspaceId],
    );
    if (this.qrExpiryTimer) clearTimeout(this.qrExpiryTimer);
    this.qrExpiryTimer = setTimeout(() => {
      void pool.query(
        `update crm.whatsapp_connection
            set qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null,
                status = case when status = 'qr_ready' then 'connecting' else status end
          where workspace_id = $1 and qr_expires_at <= now()`,
        [this.workspaceId],
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
    await clearBaileysAuthState(this.workspaceId);
    await pool.query(
      `update crm.whatsapp_connection
          set status = 'disconnected', connected_jid = null, connected_phone = null, display_name = null,
              last_error = null, reachout_lock = null, new_chat_cap = null, last_disconnected_at = now(),
              qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null
        where workspace_id = $1`,
      [this.workspaceId],
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
    const socket = this.socket;
    const jid = phoneE164ToJid(input.phoneE164);
    const column = sourceColumn(input.source);
    const sourceId = input.source.id;
    const proposedMessageId = generateMessageIDV2(socket.user?.id);
    const prepared = await withTransaction(async (db) => {
      // The outbound row records the contact the message is for (from the source's deal).
      await db.query(
        `insert into crm.whatsapp_outbound_messages (workspace_id, contact_id, ${column}, message_id, remote_jid)
         select $1, d.contact_id, s.id, $3, $4 ${sourceFrom(input.source)} where s.id = $2
         on conflict (${column}) do nothing`,
        [this.workspaceId, sourceId, proposedMessageId, jid],
      );
      const row = (await db.query<OutboundRow>(`select message_id, remote_jid, status from crm.whatsapp_outbound_messages where ${column} = $1`, [sourceId])).rows[0];
      if (!row) throw new PermanentProviderError("The WhatsApp send's source no longer exists.");
      // Text-only placeholder even when this send carries an attachment: a retry-receipt request in the
      // narrow window before the real send would be served this placeholder. Accepted minor edge case.
      const retryPayload = proto.Message.toObject(proto.Message.fromObject({ conversation: input.body }));
      const encrypted = encryptBytes(Buffer.from(JSON.stringify(retryPayload), "utf8"), `whatsapp:outbound:${row.message_id}`);
      await db.query(
        `update crm.whatsapp_outbound_messages
            set payload_ciphertext = $2, payload_iv = $3, payload_tag = $4, key_version = $5, updated_at = now()
          where ${column} = $1 and payload_ciphertext is null`,
        [sourceId, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion],
      );
      return row;
    });
    if (prepared.remote_jid !== jid) {
      throw new PermanentProviderError("The contact phone changed after this WhatsApp send was prepared; it was not redirected.");
    }

    // Short transaction: row locks are released before the spacing sleep, so a disable toggle is never blocked.
    const claim = await withTransaction((db) =>
      claimOutboundSend(db, this.workspaceId, { source: input.source, phoneE164: input.phoneE164, preparedMessageId: prepared.message_id }, socket, this.connected),
    );
    if (claim.kind === "not_registered") throw new PermanentProviderError("Recipient is not registered on WhatsApp.");
    if (claim.kind === "already_sent") return { providerMessageId: claim.messageId };
    if (claim.waitMs > 0) await sleep(claim.waitMs);

    // Re-check the emergency switch and connection after the sleep (the locks were released before it).
    const recheck = await pool.query<{ enabled: boolean; status: string }>(`select enabled, status from crm.whatsapp_connection where workspace_id = $1`, [
      this.workspaceId,
    ]);
    if (!recheck.rows[0]?.enabled) throw new ProviderDeferredError("WhatsApp outbound is disabled by the emergency switch.");
    if (recheck.rows[0].status !== "connected" || !this.socket || !this.connected) throw new ProviderDeferredError("WhatsApp is not connected.");

    let messageContent: AnyMessageContent = { text: input.body };
    if (input.attachment) {
      const { data, error } = await supabaseAdmin.storage.from(input.attachment.bucket).download(input.attachment.storagePath);
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
        `update crm.whatsapp_outbound_messages
            set status = 'sent', payload_ciphertext = $2, payload_iv = $3, payload_tag = $4,
                key_version = $5, sent_at = now(), last_error = null, updated_at = now()
          where ${column} = $1`,
        [sourceId, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion],
      );
      return { providerMessageId: claim.messageId };
    });
  }
}

/** `from crm.<source> s join crm.deals d` for a send source (every source row has a deal_id). */
function sourceFrom(source: WhatsAppSendSource) {
  const table = source.type === "scheduled_action" ? "scheduled_actions" : source.type === "proposal" ? "proposals" : "meetings";
  return `from crm.${table} s join crm.deals d on d.id = s.deal_id`;
}

/** Still sendable: a workflow action must be executing on an automatable deal; a human-triggered send must still be "sending". */
const SOURCE_STILL_SENDABLE: Record<WhatsAppSendSource["type"], string> = {
  scheduled_action: `s.status = 'executing' and d.outcome in ('open', 'nurture') and d.automation_mode = 'active'
    and exists (select 1 from crm.workflow_runs r where r.id = s.workflow_run_id and r.status in ('running', 'waiting'))`,
  proposal: `s.whatsapp_send_status = 'sending'`,
  meeting: `s.notify_whatsapp_status = 'sending'`,
};

/** The socket calls the claim step needs (a fake one in tests). */
export type ClaimSocket = Pick<WASocket, "fetchAccountReachoutTimelock" | "fetchNewChatMessageCap" | "onWhatsApp">;

export type OutboundClaim =
  | { kind: "send"; messageId: string; waitMs: number }
  | { kind: "already_sent"; messageId: string }
  | { kind: "not_registered" };

/**
 * Claims one outbound WhatsApp send inside the caller's transaction: emergency switch and
 * connection, WhatsApp reachout/new-chat restrictions, the source is still sendable, consent
 * (sendBlockReason: contact active, channel allowed), this workspace's Asia/Kolkata daily cap,
 * recipient registration, and send spacing. Throws ProviderDeferredError (try again later) or
 * PermanentProviderError (never send). "not_registered" is returned, not thrown, so the failed
 * status and the channel update it writes are committed.
 */
export async function claimOutboundSend(
  db: PoolClient,
  workspaceId: string,
  input: { source: WhatsAppSendSource; phoneE164: string; preparedMessageId: string },
  socket: ClaimSocket,
  connected: boolean,
): Promise<OutboundClaim> {
  const column = sourceColumn(input.source);
  const sourceId = input.source.id;
  await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.phoneE164]);
  const control = (await db.query<ConnectionControl>(`select * from crm.whatsapp_connection where workspace_id = $1 for update`, [workspaceId])).rows[0];
  if (!control?.enabled) throw new ProviderDeferredError("WhatsApp outbound is disabled by the emergency switch.");
  if (control.status !== "connected" || !connected) throw new ProviderDeferredError("WhatsApp is not connected.");

  const [liveReachout, liveCap] = await Promise.all([
    socket.fetchAccountReachoutTimelock().catch(() => control.reachout_lock),
    socket.fetchNewChatMessageCap().catch(() => control.new_chat_cap),
  ]);
  await db.query(`update crm.whatsapp_connection set reachout_lock = $1, new_chat_cap = $2 where workspace_id = $3`, [jsonSafe(liveReachout), jsonSafe(liveCap), workspaceId]);
  if (isOutboundRestricted(liveReachout, liveCap)) throw new ProviderDeferredError("WhatsApp has applied a reachout or new-chat restriction.", 300_000);

  const target = (
    await db.query<{ contact_id: string; phone_e164: string | null }>(
      `select d.contact_id, c.phone_e164
         ${sourceFrom(input.source)}
         join crm.contacts c on c.id = d.contact_id
        where s.id = $1 and s.workspace_id = $2 and ${SOURCE_STILL_SENDABLE[input.source.type]}
        for update of s`,
      [sourceId, workspaceId],
    )
  ).rows[0];
  if (!target || target.phone_e164 !== input.phoneE164) throw new PermanentProviderError("The contact is no longer eligible for this WhatsApp send.");
  const blocked = await sendBlockReason(db, target.contact_id, "whatsapp");
  if (blocked) throw new PermanentProviderError(blocked);

  const daily = await db.query<{ count: string }>(
    `select count(*)::text as count from crm.whatsapp_outbound_messages
      where workspace_id = $1 and status = 'sent'
        and sent_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`,
    [workspaceId],
  );
  if (Number(daily.rows[0]?.count ?? 0) >= control.daily_cap) throw new ProviderDeferredError("The Asia/Kolkata WhatsApp daily cap has been reached.", 300_000);

  const existing = (await db.query<OutboundRow>(`select message_id, remote_jid, status from crm.whatsapp_outbound_messages where ${column} = $1`, [sourceId])).rows[0];
  if (existing?.status === "sent") return { kind: "already_sent", messageId: existing.message_id };
  const messageId = existing?.message_id ?? input.preparedMessageId;

  const registered = await socket.onWhatsApp(input.phoneE164.slice(1));
  if (!registered?.some((entry) => entry.exists)) {
    await db.query(`update crm.whatsapp_outbound_messages set status = 'failed', last_error = 'Recipient is not on WhatsApp' where ${column} = $1`, [sourceId]);
    await db.query(
      `insert into crm.contact_channels (contact_id, channel, status, reason) values ($1, 'whatsapp', 'invalid', 'Number is not registered on WhatsApp')
       on conflict (contact_id, channel) do update set status = 'invalid', reason = excluded.reason, updated_by = null`,
      [target.contact_id],
    );
    return { kind: "not_registered" };
  }

  const latest = await db.query<{ sent_at: Date | null }>(`select max(sent_at) as sent_at from crm.whatsapp_outbound_messages where workspace_id = $1 and status = 'sent'`, [workspaceId]);
  const spacing = randomSpacingMs(control.min_delay_seconds, control.max_delay_seconds);
  const elapsed = latest.rows[0]?.sent_at ? Date.now() - latest.rows[0].sent_at.getTime() : spacing;
  return { kind: "send", messageId, waitMs: elapsed < spacing ? spacing - elapsed : 0 };
}
