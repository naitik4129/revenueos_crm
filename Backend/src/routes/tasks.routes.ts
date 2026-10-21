import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseId, parseQuery } from "../validation/parse.js";
import { TASK_STATUSES, TASK_TYPES } from "../domain/enums.js";
import { cancelTask, completeTask, createTask, listTasks, taskToDto, updateTask } from "../services/tasks.service.js";

/** Mounted under the workspace-gated crmRouter (routes/index.ts). */
export const tasksRouter = Router();

const id = (req: { params: Record<string, string | undefined> }) => parseId(req.params.id, "Task");
const flag = z.enum(["true", "false"]);

tasksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({
        ownerId: z.string().uuid().optional(),
        dealId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        status: z.enum(TASK_STATUSES).optional(),
        type: z.enum(TASK_TYPES).optional(),
        overdueOnly: flag.optional(),
        dueTodayOnly: flag.optional(),
        upcomingOnly: flag.optional(),
        limit: z.coerce.number().int().positive().max(1000).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
      req.query,
    );
    res.json(await listTasks(pool, req.workspaceId!, { ...q, overdueOnly: q.overdueOnly === "true", dueTodayOnly: q.dueTodayOnly === "true", upcomingOnly: q.upcomingOnly === "true" }));
  }),
);

const createSchema = z
  .object({
    dealId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    ownerId: z.string().uuid().optional(),
    type: z.enum(TASK_TYPES),
    title: z.string().min(1),
    dueAt: z.string().datetime({ offset: true }),
  })
  .refine((t) => t.dealId || t.contactId, { message: "A task needs a dealId or a contactId." });

tasksRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const task = await withTransaction((db) => createTask(db, req.actor!, req.workspaceId!, { ...input, ownerId: input.ownerId ?? req.actor!.id }));
    res.status(201).json(taskToDto(task));
  }),
);

const updateSchema = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  type: z.enum(TASK_TYPES).optional(),
  title: z.string().min(1).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
});

tasksRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(updateSchema, req.body);
    res.json(taskToDto(await withTransaction((db) => updateTask(db, req.actor!, req.workspaceId!, id(req), patch))));
  }),
);

tasksRouter.post(
  "/:id/complete",
  asyncHandler(async (req, res) => {
    res.json(taskToDto(await withTransaction((db) => completeTask(db, req.actor!, req.workspaceId!, id(req)))));
  }),
);

tasksRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(z.object({ reason: z.string().optional() }), req.body ?? {});
    res.json(taskToDto(await withTransaction((db) => cancelTask(db, req.actor!, req.workspaceId!, id(req), reason))));
  }),
);
