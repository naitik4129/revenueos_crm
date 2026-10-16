import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAdmin, requireAuth } from "../authMiddleware.js";
import { parseBody, parseParams } from "../validation/parse.js";
import * as users from "../services/admin-users.service.js";

/** CRM user management (admins only). Workspaces and members live in workspaces.routes.ts. */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/users", asyncHandler(async (_req, res) => res.json({ data: await users.listUsers() })));

const roleSchema = z.enum(["admin", "salesperson"]);

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).optional(),
  password: z.string().min(12).optional(),
  role: roleSchema.optional(),
});
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
