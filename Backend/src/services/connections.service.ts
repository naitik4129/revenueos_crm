import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import type { Queryable } from "../dto.js";
import { ValidationError } from "../errors.js";
import { decryptJson, decryptText, encryptJson, type EncryptedValue } from "../security/encryption.js";
import { recordAdminAudit } from "./admin-audit.service.js";

export interface EmailSettings {
  senderName?: string;
  senderAddress?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: "tls" | "starttls";
}

export interface EmailSecrets {
  resendApiKey?: string;
  smtpUsername?: string;
  smtpPassword?: string;
}

interface EmailRow {
  provider: "resend" | "smtp" | null;
  enabled: boolean;
  settings: EmailSettings;
  secret_ciphertext: Buffer | null;
  secret_iv: Buffer | null;
  secret_tag: Buffer | null;
  key_version: number;
  updated_at: Date;
}

function encryptedFromRow(row: EmailRow): EncryptedValue | null {
  if (!row.secret_ciphertext || !row.secret_iv || !row.secret_tag) return null;
  return { ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag, keyVersion: row.key_version };
}

export async function loadEmailConnection(db: Queryable = pool) {
  const result = await db.query<EmailRow>(`select * from public.integration_connections where id = 'email'`);
  const row = result.rows[0]!;
  const encrypted = encryptedFromRow(row);
  const secrets = encrypted ? decryptJson<EmailSecrets>(encrypted, "integration:email") : {};
  return { row, secrets };
}

export async function getEmailConnection() {
  const { row, secrets } = await loadEmailConnection();
  const fallbackConfigured = Boolean(process.env.RESEND_API_KEY && process.env.SMTP_FROM_ADDRESS);
  return {
    provider: row.provider,
    enabled: row.enabled,
    senderName: row.settings.senderName ?? "",
    senderAddress: row.settings.senderAddress ?? "",
    smtpHost: row.settings.smtpHost ?? "",
    smtpPort: row.settings.smtpPort ?? 587,
    smtpSecurity: row.settings.smtpSecurity ?? "starttls",
    resendApiKeyConfigured: Boolean(secrets.resendApiKey),
    smtpUsernameConfigured: Boolean(secrets.smtpUsername),
    smtpPasswordConfigured: Boolean(secrets.smtpPassword),
    environmentFallbackConfigured: fallbackConfigured,
    source: row.provider ? "database" : fallbackConfigured ? "environment" : "unconfigured",
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface UpdateEmailConnectionInput extends EmailSettings {
  provider: "resend" | "smtp";
  enabled: boolean;
  resendApiKey?: string;
  smtpUsername?: string;
  smtpPassword?: string;
}

export async function updateEmailConnection(actor: Actor, input: UpdateEmailConnectionInput) {
  const current = await loadEmailConnection();
  const secrets: EmailSecrets = { ...current.secrets };
  if (input.resendApiKey !== undefined && input.resendApiKey !== "") secrets.resendApiKey = input.resendApiKey;
  if (input.smtpUsername !== undefined && input.smtpUsername !== "") secrets.smtpUsername = input.smtpUsername;
  if (input.smtpPassword !== undefined && input.smtpPassword !== "") secrets.smtpPassword = input.smtpPassword;

  if (!input.senderAddress || !input.senderName) throw new ValidationError("Sender name and address are required.");
  if (input.provider === "resend" && !secrets.resendApiKey) throw new ValidationError("A Resend API key is required.");
  if (input.provider === "smtp") {
    if (!input.smtpHost || !input.smtpPort || !input.smtpSecurity || !secrets.smtpUsername || !secrets.smtpPassword) {
      throw new ValidationError("SMTP host, port, encrypted transport, username, and password are required.");
    }
  }

  const encrypted = encryptJson(secrets, "integration:email");
  await withTransaction(async (db) => {
    await db.query(
      `update public.integration_connections
          set provider = $1, enabled = $2, settings = $3,
              secret_ciphertext = $4, secret_iv = $5, secret_tag = $6, key_version = $7, updated_by = $8
        where id = 'email'`,
      [
        input.provider,
        input.enabled,
        {
          senderName: input.senderName,
          senderAddress: input.senderAddress,
          smtpHost: input.smtpHost,
          smtpPort: input.smtpPort,
          smtpSecurity: input.smtpSecurity,
        },
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        encrypted.keyVersion,
        actor.id,
      ],
    );
    await recordAdminAudit(db, actor, "connection.email.updated", "integration_connection", "email", {
      provider: input.provider,
      enabled: input.enabled,
    });
  });
  return getEmailConnection();
}

interface WhatsAppRow {
  enabled: boolean;
  desired_state: string;
  status: string;
  connected_phone: string | null;
  display_name: string | null;
  qr_ciphertext: Buffer | null;
  qr_iv: Buffer | null;
  qr_tag: Buffer | null;
  qr_key_version: number;
  qr_expires_at: Date | null;
  last_error: string | null;
  reachout_lock: unknown;
  new_chat_cap: unknown;
  worker_heartbeat_at: Date | null;
  last_connected_at: Date | null;
  last_disconnected_at: Date | null;
  daily_cap: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
}

export async function getWhatsAppConnection() {
  const result = await pool.query<WhatsAppRow>(`select * from public.whatsapp_connection where id = true`);
  const row = result.rows[0]!;
  const qr =
    row.qr_ciphertext && row.qr_iv && row.qr_tag && row.qr_expires_at && row.qr_expires_at.getTime() > Date.now()
      ? decryptText(
          { ciphertext: row.qr_ciphertext, iv: row.qr_iv, tag: row.qr_tag, keyVersion: row.qr_key_version },
          "whatsapp:pairing-qr",
        )
      : null;
  const [counts, invalid, review] = await Promise.all([
    pool.query<{ today: string; pending: string }>(
      `select
         count(*) filter (where sent_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::text as today,
         (select count(*)::text from public.scheduled_actions where action_type = 'send_whatsapp' and status in ('pending','due','executing','paused')) as pending
       from public.whatsapp_outbound_messages
      where status = 'sent'`,
    ),
    pool.query<{ count: string }>(`select count(*)::text as count from public.leads where nullif(trim(phone), '') is not null and phone_e164 is null`),
    pool.query<{
      message_id: string;
      sender_phone_e164: string | null;
      message_type: string;
      received_at: Date;
      match_count: number;
      disposition: "unmatched" | "ambiguous";
    }>(
      `select message_id, sender_phone_e164, message_type, received_at, match_count, disposition
         from public.whatsapp_inbound_events
        where disposition in ('unmatched', 'ambiguous')
        order by received_at desc
        limit 20`,
    ),
  ]);
  return {
    enabled: row.enabled,
    desiredState: row.desired_state,
    status: row.status,
    connectedPhone: row.connected_phone,
    displayName: row.display_name,
    qr,
    qrExpiresAt: row.qr_expires_at?.toISOString() ?? null,
    lastError: row.last_error,
    reachoutLock: row.reachout_lock,
    newChatCap: row.new_chat_cap,
    workerHeartbeatAt: row.worker_heartbeat_at?.toISOString() ?? null,
    lastConnectedAt: row.last_connected_at?.toISOString() ?? null,
    lastDisconnectedAt: row.last_disconnected_at?.toISOString() ?? null,
    dailyCap: row.daily_cap,
    minDelaySeconds: row.min_delay_seconds,
    maxDelaySeconds: row.max_delay_seconds,
    todayCount: Number(counts.rows[0]?.today ?? 0),
    pendingCount: Number(counts.rows[0]?.pending ?? 0),
    invalidPhoneCount: Number(invalid.rows[0]?.count ?? 0),
    outboundRestricted: Boolean(
      (row.reachout_lock as { isActive?: boolean } | null)?.isActive ||
        (row.new_chat_cap as { capping_status?: string; ote_status?: string } | null)?.capping_status === "CAPPED" ||
        (row.new_chat_cap as { capping_status?: string; ote_status?: string } | null)?.ote_status === "EXHAUSTED",
    ),
    inboundReview: review.rows.map((event) => ({
      messageId: event.message_id,
      senderPhoneE164: event.sender_phone_e164,
      messageType: event.message_type,
      receivedAt: event.received_at.toISOString(),
      matchCount: event.match_count,
      disposition: event.disposition,
    })),
  };
}

export async function updateWhatsAppSettings(
  actor: Actor,
  input: { enabled: boolean; dailyCap: number },
) {
  await withTransaction(async (db) => {
    await db.query(
      `update public.whatsapp_connection
          set enabled = $1, daily_cap = $2, updated_by = $3
        where id = true`,
      [input.enabled, input.dailyCap, actor.id],
    );
    await recordAdminAudit(db, actor, "connection.whatsapp.settings_updated", "whatsapp_connection", "shared", input);
  });
  return getWhatsAppConnection();
}

export async function commandWhatsApp(actor: Actor, command: "connect" | "restart" | "logout") {
  const desired = command === "logout" ? "disconnected" : command === "restart" ? "restart" : "connected";
  await withTransaction(async (db) => {
    await db.query(
      `update public.whatsapp_connection
          set desired_state = $1, command_version = command_version + 1, updated_by = $2,
              qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null
        where id = true`,
      [desired, actor.id],
    );
    await recordAdminAudit(db, actor, `connection.whatsapp.${command}`, "whatsapp_connection", "shared");
  });
  return getWhatsAppConnection();
}
