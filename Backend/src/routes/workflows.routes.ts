import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseParams, parseQuery } from "../validation/parse.js";
import { WORKFLOW_STATUSES, WORKFLOW_STEP_ACTIONS, WORKFLOW_TRIGGERS, TEMPLATE_CHANNELS } from "../domain/enums.js";
import * as workflowsService from "../services/workflows.service.js";
import { ValidationError } from "../errors.js";

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

workflowsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ data: await workflowsService.listWorkflows(pool) });
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: z.enum(WORKFLOW_TRIGGERS),
  ownerId: z.string().uuid().optional(),
});

workflowsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const workflow = await withTransaction((client) => workflowsService.createWorkflow(client, req.actor!, input));
    res.status(201).json(workflow);
  }),
);

workflowsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await workflowsService.getWorkflow(pool, req.params.id!));
  }),
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(WORKFLOW_STATUSES).optional(),
  ownerId: z.string().uuid().optional(),
  trigger: z.enum(WORKFLOW_TRIGGERS).optional(),
});

workflowsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(updateSchema, req.body);
    const workflow = await withTransaction((client) => workflowsService.updateWorkflow(client, req.params.id!, patch));
    res.json(workflow);
  }),
);

workflowsRouter.post(
  "/:id/draft",
  asyncHandler(async (req, res) => {
    const workflow = await withTransaction((client) => workflowsService.createDraft(client, req.actor!, req.params.id!));
    res.status(201).json(workflow);
  }),
);

const stepSchema = z.object({
  order: z.number().int().min(0),
  delayDays: z.number().int().min(0),
  action: z.enum(WORKFLOW_STEP_ACTIONS),
  templateId: z.string().uuid().optional().nullable(),
  config: z.string().optional().nullable(),
  enabled: z.boolean(),
});
const stepsSchema = z.object({ steps: z.array(stepSchema) });
const versionParamSchema = z.object({ version: z.coerce.number().int().positive() });

workflowsRouter.put(
  "/:id/versions/:version/steps",
  asyncHandler(async (req, res) => {
    const { steps } = parseBody(stepsSchema, req.body);
    const { version } = parseParams(versionParamSchema, req.params);
    const workflow = await withTransaction((client) => workflowsService.updateDraftSteps(client, req.params.id!, version, steps));
    res.json(workflow);
  }),
);

const publishSchema = z.object({ enrollmentMode: z.literal("keep_existing").optional() });

workflowsRouter.post(
  "/:id/versions/:version/publish",
  asyncHandler(async (req, res) => {
    const { enrollmentMode } = parseBody(publishSchema, req.body ?? {});
    const { version } = parseParams(versionParamSchema, req.params);
    const workflow = await withTransaction((client) =>
      workflowsService.publishVersion(client, req.actor!, req.params.id!, version, enrollmentMode),
    );
    res.json(workflow);
  }),
);

workflowsRouter.post(
  "/:id/duplicate",
  asyncHandler(async (req, res) => {
    const workflow = await withTransaction((client) => workflowsService.duplicateWorkflow(client, req.actor!, req.params.id!));
    res.status(201).json(workflow);
  }),
);

const deleteWorkflowQuerySchema = z.object({ force: z.coerce.boolean().optional() });

workflowsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { force } = parseQuery(deleteWorkflowQuerySchema, req.query);
    await withTransaction((client) => workflowsService.deleteWorkflow(client, req.params.id!, { force }));
    res.status(204).send();
  }),
);

// --- Templates ---------------------------------------------------------------

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ data: await workflowsService.listTemplatesWithAttachments(pool) });
  }),
);

const createTemplateSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(TEMPLATE_CHANNELS),
  subject: z.string().optional(),
  body: z.string().min(1),
});

templatesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createTemplateSchema, req.body);
    const template = await withTransaction((client) => workflowsService.createTemplate(client, req.actor!, input));
    res.status(201).json(template);
  }),
);

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().optional(),
  body: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

templatesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(updateTemplateSchema, req.body);
    const template = await withTransaction((client) => workflowsService.updateTemplate(client, req.params.id!, patch));
    res.json(template);
  }),
);

templatesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await withTransaction((client) => workflowsService.deleteTemplate(client, req.params.id!));
    res.status(204).send();
  }),
);

// --- Template attachments -----------------------------------------------------

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      cb(new ValidationError(`Unsupported file type: ${file.mimetype}. Allowed: PDF, Word, Excel, or images.`));
      return;
    }
    cb(null, true);
  },
});

function uploadSingleAttachment(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(new ValidationError(err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 15MB)." : err.message));
      return;
    }
    next(err);
  });
}

templatesRouter.post(
  "/:id/attachments",
  uploadSingleAttachment,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("No file uploaded.");
    const attachment = await withTransaction((client) =>
      workflowsService.createTemplateAttachment(client, req.params.id!, {
        buffer: req.file!.buffer,
        originalName: req.file!.originalname,
        mimeType: req.file!.mimetype,
        size: req.file!.size,
      }),
    );
    res.status(201).json(attachment);
  }),
);

templatesRouter.delete(
  "/:id/attachments/:attachmentId",
  asyncHandler(async (req, res) => {
    await withTransaction((client) =>
      workflowsService.deleteTemplateAttachment(client, req.params.id!, req.params.attachmentId!),
    );
    res.status(204).send();
  }),
);
