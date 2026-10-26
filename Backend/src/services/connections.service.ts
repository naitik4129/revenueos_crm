import { randomBytes } from "node:crypto";
import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import type { Queryable } from "../dto.js";
import { env } from "../env.js";
import { ValidationError } from "../errors.js";
import { decryptJson, decryptText, encryptJson, encryptText, type EncryptedValue } from "../security/encryption.js";
import { recordAdminAudit } from "./admin-audit.service.js";
import { exchangeCodeForTokens, getAuthorizationUrl, type GoogleOAuthClientConfig } from "../providers/google-calendar.provider.js";

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

/** Connection rows are created on first use (nothing is seeded): one per workspace and provider. */
export async function ensureConnectionRows(workspaceId: string, db: Queryable = pool) {
  await db.query(`insert into crm_integration_connections (workspace_id, id) values ($1, 'email') on conflict do nothing`, [workspaceId]);
  await db.query(`insert into crm_whatsapp_connection (workspace_id) values ($1) on conflict do nothing`, [workspaceId]);
  await db.query(`insert into crm_google_calendar_connection (workspace_id) values ($1) on conflict do nothing`, [workspaceId]);
}

export async function loadEmailConnection(workspaceId: string, db: Queryable = pool) {
  await ensureConnectionRows(workspaceId, db);
  const result = await db.query<EmailRow>(
    `select * from crm_integration_connections where workspace_id = $1 and id = 'email'`,
    [workspaceId],
  );
  const row = result.rows[0]!;
  const encrypted = encryptedFromRow(row);
  // AAD is deliberately a fixed string, not workspace-namespaced — see
  // baileys-auth.store.ts's comment for why: existing secrets were
  // encrypted under this exact AAD before per-workspace scoping shipped,
  // and AES-GCM throws on any AAD mismatch. Row-level isolation is already
  // enforced by the `where workspace_id = $1` query above.
  const secrets = encrypted ? decryptJson<EmailSecrets>(encrypted, "integration:email") : {};
  return { row, secrets };
}

export async function getEmailConnection(workspaceId: string) {
  const { row, secrets } = await loadEmailConnection(workspaceId);
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

export async function updateEmailConnection(actor: Actor, workspaceId: string, input: UpdateEmailConnectionInput) {
  const current = await loadEmailConnection(workspaceId);
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
      `update crm_integration_connections
          set provider = $1, enabled = $2, settings = $3,
              secret_ciphertext = $4, secret_iv = $5, secret_tag = $6, key_version = $7, updated_by = $8
        where workspace_id = $9 and id = 'email'`,
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
        workspaceId,
      ],
    );
    await recordAdminAudit(db, actor, "connection.email.updated", "integration_connection", `${workspaceId}:email`, {
      provider: input.provider,
      enabled: input.enabled,
    });
  });
  return getEmailConnection(workspaceId);
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

export async function getWhatsAppConnection(workspaceId: string) {
  await ensureConnectionRows(workspaceId);
  const result = await pool.query<WhatsAppRow>(`select * from crm_whatsapp_connection where workspace_id = $1`, [workspaceId]);
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
         (select count(*)::text from crm_scheduled_actions where workspace_id = $1 and action_type = 'send_whatsapp' and status in ('pending','due','executing','paused')) as pending
       from crm_whatsapp_outbound_messages
      where workspace_id = $1 and status = 'sent'`,
      [workspaceId],
    ),
    pool.query<{ count: string }>(
      `select count(*)::text as count from crm_contacts where workspace_id = $1 and status <> 'merged' and nullif(trim(phone), '') is not null and phone_e164 is null`,
      [workspaceId],
    ),
    pool.query<{
      message_id: string;
      sender_phone_e164: string | null;
      message_type: string;
      received_at: Date;
      match_count: number;
      disposition: "unmatched" | "ambiguous";
    }>(
      `select message_id, sender_phone_e164, message_type, received_at, match_count, disposition
         from crm_whatsapp_inbound_events
        where workspace_id = $1 and disposition in ('unmatched', 'ambiguous')
        order by received_at desc
        limit 20`,
      [workspaceId],
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
  workspaceId: string,
  input: { enabled: boolean; dailyCap: number },
) {
  await withTransaction(async (db) => {
    await db.query(
      `update crm_whatsapp_connection
          set enabled = $1, daily_cap = $2, updated_by = $3
        where workspace_id = $4`,
      [input.enabled, input.dailyCap, actor.id, workspaceId],
    );
    await recordAdminAudit(db, actor, "connection.whatsapp.settings_updated", "whatsapp_connection", workspaceId, input);
  });
  return getWhatsAppConnection(workspaceId);
}

export async function commandWhatsApp(actor: Actor, workspaceId: string, command: "connect" | "restart" | "logout") {
  const desired = command === "logout" ? "disconnected" : command === "restart" ? "restart" : "connected";
  await withTransaction(async (db) => {
    await db.query(
      `update crm_whatsapp_connection
          set desired_state = $1, command_version = command_version + 1, updated_by = $2,
              qr_ciphertext = null, qr_iv = null, qr_tag = null, qr_expires_at = null
        where workspace_id = $3`,
      [desired, actor.id, workspaceId],
    );
    await recordAdminAudit(db, actor, `connection.whatsapp.${command}`, "whatsapp_connection", workspaceId);
  });
  return getWhatsAppConnection(workspaceId);
}

interface GoogleCalendarRow {
  enabled: boolean;
  status: "disconnected" | "connected" | "error";
  client_id: string | null;
  redirect_uri: string | null;
  client_secret_ciphertext: Buffer | null;
  client_secret_iv: Buffer | null;
  client_secret_tag: Buffer | null;
  client_secret_key_version: number;
  connected_email: string | null;
  connected_calendar_id: string;
  refresh_token_ciphertext: Buffer | null;
  refresh_token_iv: Buffer | null;
  refresh_token_tag: Buffer | null;
  refresh_token_key_version: number;
  pending_oauth_state: string | null;
  pending_oauth_state_expires_at: Date | null;
  updated_by: string | null;
  last_error: string | null;
  last_synced_at: Date | null;
  updated_at: Date;
}

async function loadGoogleCalendarRow(workspaceId: string, db: Queryable = pool): Promise<GoogleCalendarRow> {
  await ensureConnectionRows(workspaceId, db);
  const result = await db.query<GoogleCalendarRow>(`select * from crm_google_calendar_connection where workspace_id = $1`, [workspaceId]);
  return result.rows[0]!;
}

// AAD strings below are deliberately fixed, not workspace-namespaced — see
// baileys-auth.store.ts's comment: existing secrets were encrypted under
// these exact AAD values before per-workspace scoping shipped, and AES-GCM
// throws on any AAD mismatch. Row-level isolation is already enforced by
// the `where workspace_id = $1` queries these values are read through.
function decryptClientSecret(row: GoogleCalendarRow): string | null {
  if (!row.client_secret_ciphertext || !row.client_secret_iv || !row.client_secret_tag) return null;
  return decryptText(
    { ciphertext: row.client_secret_ciphertext, iv: row.client_secret_iv, tag: row.client_secret_tag, keyVersion: row.client_secret_key_version },
    "integration:google_calendar:client_secret",
  );
}

/** The platform-wide Google OAuth app from the GOOGLE_OAUTH_* env vars (validated all-or-none in env.ts), or null when not configured. */
function platformGoogleOAuthConfig(): GoogleOAuthClientConfig | null {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) return null;
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  };
}

/**
 * Used by meeting-calendar sync (Backend/src/services/meeting-calendar-sync.service.ts)
 * to get both the connected account (refreshToken) and the OAuth app to
 * authenticate as (oauthConfig). The OAuth app is the workspace's own
 * DB-stored client when it has fully entered one (an "advanced" override),
 * otherwise the platform-wide app from the environment — which is what makes
 * the one-click Connect flow work. `oauthConfig` is null only when neither
 * exists. Note a refresh token is bound to the client that issued it, so
 * switching between the two sources requires reconnecting.
 */
export async function loadGoogleCalendarConnection(workspaceId: string, db: Queryable = pool) {
  const row = await loadGoogleCalendarRow(workspaceId, db);
  const refreshToken =
    row.refresh_token_ciphertext && row.refresh_token_iv && row.refresh_token_tag
      ? decryptText(
          { ciphertext: row.refresh_token_ciphertext, iv: row.refresh_token_iv, tag: row.refresh_token_tag, keyVersion: row.refresh_token_key_version },
          "integration:google_calendar:refresh_token",
        )
      : null;
  const clientSecret = decryptClientSecret(row);
  const ownConfig: GoogleOAuthClientConfig | null =
    row.client_id && clientSecret && row.redirect_uri
      ? { clientId: row.client_id, clientSecret, redirectUri: row.redirect_uri }
      : null;
  const oauthConfig = ownConfig ?? platformGoogleOAuthConfig();
  return { row, refreshToken, oauthConfig, usesOwnCredentials: ownConfig !== null };
}

export async function getGoogleCalendarConnection(workspaceId: string) {
  const row = await loadGoogleCalendarRow(workspaceId);
  const clientSecretConfigured = Boolean(row.client_secret_ciphertext);
  const ownCredentialsConfigured = Boolean(row.client_id && clientSecretConfigured && row.redirect_uri);
  const platformConfigured = platformGoogleOAuthConfig() !== null;
  return {
    configured: ownCredentialsConfigured || platformConfigured,
    platformConfigured,
    usesOwnCredentials: ownCredentialsConfigured,
    enabled: row.enabled,
    status: row.status,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    clientSecretConfigured,
    connectedEmail: row.connected_email,
    connectedCalendarId: row.connected_calendar_id,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface UpdateGoogleCalendarCredentialsInput {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

/** Saves the OAuth app's own credentials, entered per workspace — mirrors updateEmailConnection's write-only-secret pattern (an empty clientSecret retains whatever's already saved). */
export async function updateGoogleCalendarCredentials(actor: Actor, workspaceId: string, input: UpdateGoogleCalendarCredentialsInput) {
  if (!input.clientId.trim() || !input.redirectUri.trim()) {
    throw new ValidationError("Client ID and redirect URI are required.");
  }
  const current = await loadGoogleCalendarRow(workspaceId);
  const hasExistingSecret = Boolean(current.client_secret_ciphertext);
  if (!input.clientSecret && !hasExistingSecret) {
    throw new ValidationError("A client secret is required.");
  }

  await withTransaction(async (db) => {
    if (input.clientSecret) {
      const encrypted = encryptText(input.clientSecret, "integration:google_calendar:client_secret");
      await db.query(
        `update crm_google_calendar_connection
            set client_id = $1, redirect_uri = $2,
                client_secret_ciphertext = $3, client_secret_iv = $4, client_secret_tag = $5, client_secret_key_version = $6,
                updated_by = $7
          where workspace_id = $8`,
        [input.clientId.trim(), input.redirectUri.trim(), encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion, actor.id, workspaceId],
      );
    } else {
      await db.query(
        `update crm_google_calendar_connection set client_id = $1, redirect_uri = $2, updated_by = $3 where workspace_id = $4`,
        [input.clientId.trim(), input.redirectUri.trim(), actor.id, workspaceId],
      );
    }
    await recordAdminAudit(db, actor, "connection.google_calendar.credentials_updated", "google_calendar_connection", workspaceId, {
      clientId: input.clientId.trim(),
    });
  });
  return getGoogleCalendarConnection(workspaceId);
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export async function startGoogleCalendarOAuth(actor: Actor, workspaceId: string) {
  const { oauthConfig } = await loadGoogleCalendarConnection(workspaceId);
  if (!oauthConfig) {
    throw new ValidationError("Google Calendar isn't set up on this server yet. Ask your administrator to configure it.");
  }
  const state = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
  await pool.query(
    `update crm_google_calendar_connection
        set pending_oauth_state = $1, pending_oauth_state_expires_at = $2, updated_by = $3
      where workspace_id = $4`,
    [state, expiresAt, actor.id, workspaceId],
  );
  return { url: getAuthorizationUrl(oauthConfig, state) };
}

/**
 * Handles Google's OAuth redirect. Unauthenticated by necessity (Google's
 * browser redirect carries no bearer token, and no X-Workspace-Id header) —
 * the signed-nonce `state` round-tripped through Google is both this call's
 * only proof the request belongs to a legitimate connect flow, AND (since
 * google_calendar_connection is now one row per workspace) how the
 * originating workspace is recovered: whichever workspace's row has this
 * exact pending state is the one being completed.
 */
export async function completeGoogleCalendarOAuth(code: string, state: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const matched = await pool.query<{ workspace_id: string }>(
    `select workspace_id from crm_google_calendar_connection where pending_oauth_state = $1`,
    [state],
  );
  const workspaceId = matched.rows[0]?.workspace_id;
  if (!workspaceId) {
    return { ok: false, error: "Invalid or already-used connection request. Please try connecting again." };
  }

  const { row, oauthConfig } = await loadGoogleCalendarConnection(workspaceId);
  if (!row.pending_oauth_state_expires_at || row.pending_oauth_state_expires_at.getTime() < Date.now()) {
    return { ok: false, error: "This connection request expired. Please try connecting again." };
  }
  if (!oauthConfig) {
    return { ok: false, error: "Google Calendar isn't set up on this server anymore. Ask your administrator to configure it." };
  }

  try {
    const { refreshToken, email } = await exchangeCodeForTokens(oauthConfig, code);
    const encrypted = encryptText(refreshToken, "integration:google_calendar:refresh_token");
    await withTransaction(async (db) => {
      await db.query(
        `update crm_google_calendar_connection
            set status = 'connected', enabled = true, connected_email = $1,
                refresh_token_ciphertext = $2, refresh_token_iv = $3, refresh_token_tag = $4, refresh_token_key_version = $5,
                pending_oauth_state = null, pending_oauth_state_expires_at = null,
                last_error = null, last_synced_at = now()
          where workspace_id = $6`,
        [email, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion, workspaceId],
      );
      await recordGoogleCalendarAudit(db, row.updated_by, workspaceId, "connection.google_calendar.connected", { email });
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect Google Calendar.";
    await withTransaction(async (db) => {
      await db.query(
        `update crm_google_calendar_connection
            set status = 'error', last_error = $1, pending_oauth_state = null, pending_oauth_state_expires_at = null
          where workspace_id = $2`,
        [message, workspaceId],
      );
      await recordGoogleCalendarAudit(db, row.updated_by, workspaceId, "connection.google_calendar.connect_failed", { error: message });
    });
    return { ok: false, error: message };
  }
}

/**
 * Called when Google rejects the stored refresh token (user revoked access, or
 * it expired). Flags the connection as errored so the settings page shows a
 * Reconnect prompt, and clears the dead token so later meetings skip sync
 * cleanly instead of failing against Google every time.
 */
export async function markGoogleCalendarReauthRequired(workspaceId: string, message: string) {
  await pool.query(
    `update crm_google_calendar_connection
        set status = 'error', enabled = false, last_error = $1,
            refresh_token_ciphertext = null, refresh_token_iv = null, refresh_token_tag = null
      where workspace_id = $2 and status = 'connected'`,
    [message, workspaceId],
  );
}

/** Revokes the connected account only — the OAuth app's own client_id/client_secret/redirect_uri stay saved so reconnecting doesn't require re-entering them. */
export async function disconnectGoogleCalendar(actor: Actor, workspaceId: string) {
  await withTransaction(async (db) => {
    await db.query(
      `update crm_google_calendar_connection
          set status = 'disconnected', enabled = false, connected_email = null,
              refresh_token_ciphertext = null, refresh_token_iv = null, refresh_token_tag = null,
              pending_oauth_state = null, pending_oauth_state_expires_at = null, last_error = null,
              updated_by = $1
        where workspace_id = $2`,
      [actor.id, workspaceId],
    );
    await recordAdminAudit(db, actor, "connection.google_calendar.disconnected", "google_calendar_connection", workspaceId);
  });
  return getGoogleCalendarConnection(workspaceId);
}

/** recordAdminAudit needs a full Actor, but the OAuth callback that completes the connect flow has none — only the admin id captured when the flow started. */
async function recordGoogleCalendarAudit(db: Queryable, adminId: string | null, workspaceId: string, action: string, metadata: Record<string, unknown>) {
  let actorEmail = "unknown";
  if (adminId) {
    const result = await db.query<{ email: string }>(`select email from public.revenueos_profiles where id = $1`, [adminId]);
    actorEmail = result.rows[0]?.email ?? actorEmail;
  }
  await db.query(
    `insert into crm_admin_audit_events (actor_id, actor_email, action, target_type, target_id, metadata)
     values ($1, $2, $3, 'google_calendar_connection', $4, $5)`,
    [adminId, actorEmail, action, workspaceId, metadata],
  );
}
