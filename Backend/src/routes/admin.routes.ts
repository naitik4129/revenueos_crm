import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAdmin, requireAuth } from "../authMiddleware.js";
import { parseBody, parseParams } from "../validation/parse.js";
import * as users from "../services/admin-users.service.js";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";
import { recordAdminAudit } from "../services/admin-audit.service.js";
import { getSendPolicy, sendPolicyToDto, updateSendPolicy } from "../services/send-policy.service.js";

/** CRM user management and sending policies (admins only). Workspaces and members live in workspaces.routes.ts. */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/users", asyncHandler(async (_req, res) => res.json({ data: await users.listUsers() })));

const roleSchema = z.enum(["admin", "salesperson"]);

// Email + role only: the CRM never creates auth accounts, so name/password are rejected.
const createUserSchema = z.object({ email: z.string().email(), role: roleSchema.optional() }).strict();
adminRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    const user = await users.createUser(req.actor!, parseBody(createUserSchema, req.body));
    res.status(201).json(user);
  }),
);

const userIdParamsSchema = z.object({ id: z.string().uuid() });
const updateUserSchema = z
  .object({ role: roleSchema.optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, { message: "Nothing to update." });
adminRouter.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const { id } = parseParams(userIdParamsSchema, req.params);
    res.json(await users.updateUser(req.actor!, id, parseBody(updateUserSchema, req.body)));
  }),
);

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
  if (!(await pool.query(`select 1 from crm.workspaces where id = $1`, [id])).rowCount) throw new NotFoundError("Workspace");
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
