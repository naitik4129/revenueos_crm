import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import { ValidationError } from "../errors.js";
import { PROPOSAL_STATUSES } from "../domain/enums.js";
import { listProposals, updateProposal, updateProposalStatus } from "../services/proposals.service.js";
import { createAndSendProposal } from "../services/proposalSending.service.js";

export const proposalsRouter = Router();
proposalsRouter.use(requireAuth);

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

// 10MB — the stricter of the email (15MB) and WhatsApp (10MB) attachment
// ceilings, since one uploaded document must satisfy both channels.
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

const listQuerySchema = z.object({
  leadId: z.string().uuid().optional(),
  status: z.enum(PROPOSAL_STATUSES).optional(),
  ownerId: z.string().uuid().optional(),
});

proposalsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = parseQuery(listQuerySchema, req.query);
    res.json({ data: await listProposals(pool, filters) });
  }),
);

// multer puts multipart text fields into req.body as strings, so numeric
// fields are coerced rather than validated as JSON numbers.
const createSchema = z.object({
  leadId: z.string().uuid(),
  title: z.string().min(1),
  amount: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
  emailTemplateId: z.string().uuid(),
  whatsappTemplateId: z.string().uuid(),
});

proposalsRouter.post(
  "/",
  uploadDocument,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("A proposal document is required.");
    const input = parseBody(createSchema, req.body);
    const proposal = await createAndSendProposal(req.actor!, input, {
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
    res.status(201).json(proposal);
  }),
);

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  fileName: z.string().optional(),
  amount: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

proposalsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(updateSchema, req.body);
    const proposal = await withTransaction((client) => updateProposal(client, req.params.id!, patch));
    res.json(proposal);
  }),
);

const statusSchema = z.object({ status: z.enum(PROPOSAL_STATUSES) });

proposalsRouter.post(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = parseBody(statusSchema, req.body);
    const proposal = await withTransaction((client) => updateProposalStatus(client, req.actor!, req.params.id!, status));
    res.json(proposal);
  }),
);
