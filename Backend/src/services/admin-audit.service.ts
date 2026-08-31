import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";

export async function recordAdminAudit(
  db: Queryable,
  actor: Actor,
  action: string,
  targetType: string,
  targetId?: string | null,
  metadata?: Record<string, unknown> | null,
) {
  await db.query(
    `insert into public.admin_audit_events
      (actor_id, actor_email, action, target_type, target_id, metadata)
     values ($1, $2, $3, $4, $5, $6)`,
    [actor.id, actor.email, action, targetType, targetId ?? null, metadata ?? null],
  );
}
