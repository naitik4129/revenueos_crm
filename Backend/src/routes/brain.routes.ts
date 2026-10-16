import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool } from "../db.js";
import { AuthenticationError } from "../errors.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import { BRAIN_KEY_PREFIX, resolveBrainKey } from "../services/brain-keys.service.js";
import * as brain from "../services/brain.service.js";

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

const batch = z.object({ items: z.array(z.unknown()).min(1).max(brain.MAX_BATCH, `At most ${brain.MAX_BATCH} items per request.`) });

function batchRoute<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, handle: Parameters<typeof brain.runBatch<T>>[3]) {
  brainRouter.post(
    path,
    asyncHandler(async (req, res) => {
      const { items } = parseBody(batch, req.body);
      res.json(await brain.runBatch(req.workspaceId!, items, schema, handle));
    }),
  );
}

batchRoute("/companies", brain.companyItem, brain.upsertCompany);
batchRoute("/contacts", brain.contactItem, brain.upsertContact);
batchRoute("/calls", brain.callItem, brain.upsertCall);
batchRoute("/email-events", brain.emailEventItem, brain.upsertEmailEvent);
batchRoute("/handovers", brain.handoverItem, brain.applyHandover);

brainRouter.get(
  "/suppressions",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({ since: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().positive().max(5000).optional() }),
      req.query,
    );
    res.json(await brain.listSuppressions(pool, req.workspaceId!, q));
  }),
);
