import { createHash, randomBytes } from "node:crypto";
import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { recordAdminAudit } from "./admin-audit.service.js";

/** Keys look like `nbk_<43 url-safe chars>`; only the SHA-256 hash is stored. */
export const BRAIN_KEY_PREFIX = "nbk_";

export function hashBrainKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

interface KeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

const keyToDto = (r: KeyRow) => ({
  id: r.id,
  label: r.label,
  prefix: r.key_prefix,
  createdAt: r.created_at.toISOString(),
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
  revokedAt: r.revoked_at?.toISOString() ?? null,
});

async function assertWorkspace(workspaceId: string) {
  const ws = await pool.query(`select 1 from crm.workspaces where id = $1`, [workspaceId]);
  if (!ws.rows[0]) throw new NotFoundError("Workspace");
}

/** Returns the plain key once; it cannot be read back later. */
export async function createBrainKey(actor: Actor, workspaceId: string, label: string) {
  if (!label.trim()) throw new ValidationError("A label is required.", { field: "label" });
  await assertWorkspace(workspaceId);
  const key = BRAIN_KEY_PREFIX + randomBytes(32).toString("base64url");
  return withTransaction(async (db) => {
    const row = (
      await db.query<KeyRow>(
        `insert into crm.brain_api_keys (workspace_id, key_hash, key_prefix, label, created_by)
         values ($1, $2, $3, $4, $5)
         returning id, label, key_prefix, created_at, last_used_at, revoked_at`,
        [workspaceId, hashBrainKey(key), key.slice(0, 12), label.trim(), actor.id],
      )
    ).rows[0]!;
    await recordAdminAudit(db, actor, "brain_key.created", "workspace", workspaceId, { keyId: row.id, label: row.label });
    return { ...keyToDto(row), key };
  });
}

export async function listBrainKeys(workspaceId: string) {
  await assertWorkspace(workspaceId);
  const result = await pool.query<KeyRow>(
    `select id, label, key_prefix, created_at, last_used_at, revoked_at
       from crm.brain_api_keys where workspace_id = $1 order by created_at desc`,
    [workspaceId],
  );
  return result.rows.map(keyToDto);
}

export async function revokeBrainKey(actor: Actor, workspaceId: string, keyId: string) {
  return withTransaction(async (db) => {
    const row = (
      await db.query<KeyRow>(
        `update crm.brain_api_keys set revoked_at = coalesce(revoked_at, now())
          where id = $1 and workspace_id = $2
          returning id, label, key_prefix, created_at, last_used_at, revoked_at`,
        [keyId, workspaceId],
      )
    ).rows[0];
    if (!row) throw new NotFoundError("Brain key");
    await recordAdminAudit(db, actor, "brain_key.revoked", "workspace", workspaceId, { keyId });
    return keyToDto(row);
  });
}

/** Active key of an active workspace -> its workspace id, or null. Touches last_used_at (at most once a minute). */
export async function resolveBrainKey(key: string): Promise<{ keyId: string; workspaceId: string } | null> {
  const result = await pool.query<{ id: string; workspace_id: string }>(
    `select k.id, k.workspace_id
       from crm.brain_api_keys k
       join crm.workspaces w on w.id = k.workspace_id and w.is_active
      where k.key_hash = $1 and k.revoked_at is null`,
    [hashBrainKey(key)],
  );
  const row = result.rows[0];
  if (!row) return null;
  await pool.query(
    `update crm.brain_api_keys set last_used_at = now()
      where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`,
    [row.id],
  );
  return { keyId: row.id, workspaceId: row.workspace_id };
}
