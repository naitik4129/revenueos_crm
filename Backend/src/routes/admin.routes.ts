import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAdmin, requireAuth } from "../authMiddleware.js";
import { parseBody, parseParams } from "../validation/parse.js";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";
import { recordAdminAudit } from "../services/admin-audit.service.js";
import { getSendPolicy, sendPolicyToDto, updateSendPolicy } from "../services/send-policy.service.js";

/**
 * Admin-only operational settings: sending policies (and brain keys, in workspaces.routes.ts). CRM
 * users, workspaces and members are not managed here — the RevenueOS platform owns all of that.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

// --- Sending policies per workspace (scale step 12) ---

const sendingParamsSchema = z.object({ workspaceId: z.string().uuid() });
const sendingChannelParamsSchema = sendingParamsSchema.extend({ channel: z.enum(["email", "whatsapp"]) });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM (24-hour).");
const sendingPatchSchema = z
  .object({
    paused: z.boolean(),
    pauseReason: z.string().max(500),
    dailyCap: z.number().int().min(1),
    rampStart: z.number().int().min(1),
    rampStepPerDay: z.number().int().min(0).max(100),
    minGapSeconds: z.number().int().min(0).max(3600),
    maxGapSeconds: z.number().int().min(0).max(7200),
    windowStart: hhmm,
    windowEnd: hhmm,
    windowDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    restartRamp: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

async function assertWorkspace(id: string) {
  if (!(await pool.query(`select 1 from crm_workspaces where id = $1`, [id])).rowCount) throw new NotFoundError("Workspace");
}

adminRouter.get(
  "/sending/:workspaceId",
  asyncHandler(async (req, res) => {
    const { workspaceId } = parseParams(sendingParamsSchema, req.params);
    await assertWorkspace(workspaceId);
    const [email, whatsapp] = await withTransaction((db) => Promise.all([getSendPolicy(db, workspaceId, "email"), getSendPolicy(db, workspaceId, "whatsapp")]));
    res.json({ email: sendPolicyToDto(email), whatsapp: sendPolicyToDto(whatsapp) });
  }),
);

adminRouter.patch(
  "/sending/:workspaceId/:channel",
  asyncHandler(async (req, res) => {
    const { workspaceId, channel } = parseParams(sendingChannelParamsSchema, req.params);
    const patch = parseBody(sendingPatchSchema, req.body);
    await assertWorkspace(workspaceId);
    const row = await withTransaction(async (db) => {
      const saved = await updateSendPolicy(db, req.actor!.id, workspaceId, channel, patch);
      await recordAdminAudit(db, req.actor!, `sending.${channel}.update`, "workspace", workspaceId, { ...patch });
      return saved;
    });
    res.json(sendPolicyToDto(row));
  }),
);
