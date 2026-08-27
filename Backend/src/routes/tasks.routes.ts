import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import { TASK_STATUSES, TASK_TYPES } from "../domain/enums.js";
import { cancelTask, completeTask, createTask, listTasks, taskToDto } from "../services/tasks.service.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const listQuerySchema = z.object({
  ownerId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  type: z.enum(TASK_TYPES).optional(),
  overdueOnly: z.coerce.boolean().optional(),
  dueTodayOnly: z.coerce.boolean().optional(),
});

tasksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = parseQuery(listQuerySchema, req.query);
    res.json({ data: await listTasks(pool, filters) });
  }),
);

const createSchema = z.object({
  leadId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  type: z.enum(TASK_TYPES),
  title: z.string().min(1),
  dueAt: z.string().min(1),
});

tasksRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const task = await withTransaction((client) => createTask(client, req.actor!, { ...input, origin: "manual" }));
    res.status(201).json(taskToDto(task));
  }),
);

tasksRouter.post(
  "/:id/complete",
  asyncHandler(async (req, res) => {
    const task = await withTransaction((client) => completeTask(client, req.actor!, req.params.id!));
    res.json(taskToDto(task));
  }),
);

const cancelSchema = z.object({ reason: z.string().optional() });

tasksRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(cancelSchema, req.body ?? {});
    const task = await withTransaction((client) => cancelTask(client, req.actor!, req.params.id!, reason));
    res.json(taskToDto(task));
  }),
);
