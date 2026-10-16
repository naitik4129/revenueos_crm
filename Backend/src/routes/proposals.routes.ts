import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseId, parseQuery } from "../validation/parse.js";
import { LEAD_LOSS_REASONS, PROPOSAL_STATUSES } from "../domain/enums.js";
import { createProposal, getProposalOr404, listProposals, updateProposal, updateProposalStatus } from "../services/proposals.service.js";
import { sendProposal, uploadProposalDocument } from "../services/proposalSending.service.js";
import { ValidationError } from "../errors.js";

/**
 * Mounted under the workspace-gated crmRouter (routes/index.ts). A proposal is created as a draft,
 * gets its document (POST /:id/document, multipart field "document"), then is sent (POST /:id/send).
 */
export const proposalsRouter = Router();

const id = (req: { params: Record<string, string | undefined> }) => parseId(req.params.id, "Proposal");

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
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

// 10MB: the stricter of the email (15MB) and WhatsApp (10MB) limits, since one document goes to both.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      cb(new ValidationError(`Unsupported file type: ${file.mimetype}. Allowed: PDF, Word, Excel, or images.`));
      return;
    }
    cb(null, true);
  },
});

function uploadDocument(req: Request, res: Response, next: NextFunction) {
  upload.single("document")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(new ValidationError(err.code === "LIMIT_FILE_SIZE" ? "The proposal document is too large (max 10MB)." : err.message));
      return;
    }
    next(err);
  });
}

proposalsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({ dealId: z.string().uuid().optional(), status: z.enum(PROPOSAL_STATUSES).optional(), ownerId: z.string().uuid().optional() }),
      req.query,
    );
    res.json({ data: await listProposals(pool, req.workspaceId!, q) });
  }),
);

const createSchema = z.object({
  dealId: z.string().uuid(),
  title: z.string().min(1),
  amount: z.number().nonnegative().optional(),
  currency: z.string().trim().length(3).optional(),
  notes: z.string().optional(),
});

proposalsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    res.status(201).json(await withTransaction((db) => createProposal(db, req.actor!, req.workspaceId!, input)));
  }),
);

proposalsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await getProposalOr404(pool, req.workspaceId!, id(req)));
  }),
);

proposalsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(z.object({ title: z.string().min(1).optional(), amount: z.number().nonnegative().optional(), notes: z.string().optional() }), req.body);
    res.json(await withTransaction((db) => updateProposal(db, req.workspaceId!, id(req), patch)));
  }),
);

// lossReason is required (by the service) only for rejected/expired.
const statusSchema = z.object({
  status: z.enum(PROPOSAL_STATUSES),
  lossReason: z.enum(LEAD_LOSS_REASONS).optional(),
  lossNotes: z.string().optional(),
});

proposalsRouter.post(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status, lossReason, lossNotes } = parseBody(statusSchema, req.body);
    res.json(await withTransaction((db) => updateProposalStatus(db, req.actor!, req.workspaceId!, id(req), status, { lossReason, lossNotes })));
  }),
);

proposalsRouter.post(
  "/:id/document",
  uploadDocument,
  asyncHandler(async (req, res) => {
    const proposalId = id(req);
    if (!req.file) throw new ValidationError("A proposal document is required (multipart field \"document\").");
    res.json(
      await uploadProposalDocument(req.actor!, req.workspaceId!, proposalId, {
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      }),
    );
  }),
);

proposalsRouter.post(
  "/:id/send",
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ emailTemplateId: z.string().uuid().optional(), whatsappTemplateId: z.string().uuid().optional() }), req.body);
    res.json(await sendProposal(req.actor!, req.workspaceId!, id(req), input));
  }),
);
