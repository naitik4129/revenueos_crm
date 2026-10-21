import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool } from "../db.js";
import { AuthenticationError } from "../errors.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import { BRAIN_KEY_PREFIX, resolveBrainKey } from "../services/brain-keys.service.js";
import * as brain from "../services/brain.service.js";
import * as bulk from "../services/brain-bulk.service.js";

/**
 * The RevenueOS brain's write API. Authenticated by a per-workspace key
 * (`Authorization: Bearer nbk_...`), never by a user session; the key decides the workspace.
 */
export const brainRouter = Router();

export const requireBrainKey = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const resolved = key.startsWith(BRAIN_KEY_PREFIX) ? await resolveBrainKey(key) : null;
  if (!resolved) throw new AuthenticationError("Missing, invalid or revoked brain API key.");
  req.workspaceId = resolved.workspaceId;
  next();
});

brainRouter.use(requireBrainKey);

const batch = (max: number) => z.object({ items: z.array(z.unknown()).min(1).max(max, `At most ${max} items per request.`) });

function batchRoute<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  handle: Parameters<typeof brain.runBatch<T>>[3],
  opts: brain.BatchOptions<T>,
  max = brain.MAX_BATCH,
) {
  const body = batch(max);
  brainRouter.post(
    path,
    asyncHandler(async (req, res) => {
      const { items } = parseBody(body, req.body);
      res.json(await brain.runBatch(req.workspaceId!, items, schema, handle, opts));
    }),
  );
}

// Set-based per batch (brain-bulk.service.ts); the per-item handler is the fallback.
batchRoute("/companies", brain.companyItem, brain.upsertCompany, { label: "companies", bulk: bulk.bulkCompanies });
batchRoute("/contacts", brain.contactItem, brain.upsertContact, { label: "contacts", bulk: bulk.bulkContacts });
batchRoute("/calls", brain.callItem, brain.upsertCall, { label: "calls", bulk: bulk.bulkCalls });
batchRoute("/email-events", brain.emailEventItem, brain.upsertEmailEvent, { label: "email-events", bulk: bulk.bulkEmailEvents });
// Few and many-sided (deals, owners, notifications): per item, 4 at a time, at most 50 per request (~12 s).
batchRoute("/handovers", brain.handoverItem, brain.applyHandover, { label: "handovers", concurrency: 4, groupKey: brain.handoverKey }, brain.MAX_HANDOVER_BATCH);

brainRouter.get(
  "/suppressions",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({
        since: z.string().datetime({ offset: true }).optional(),
        cursor: z.string().max(500).optional(),
        limit: z.coerce.number().int().positive().max(5000).optional(),
      }),
      req.query,
    );
    res.json(await brain.listSuppressions(pool, req.workspaceId!, q));
  }),
);
