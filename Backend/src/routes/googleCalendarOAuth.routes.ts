import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { parseQuery } from "../validation/parse.js";
import { completeGoogleCalendarOAuth } from "../services/connections.service.js";
import { corsOrigins } from "../env.js";

/**
 * Handles Google's OAuth redirect for the shared Calendar connection. Kept
 * as its own unauthenticated router (mounted before adminRouter in
 * routes/index.ts) because Google's browser redirect carries no bearer
 * token — requireAuth would reject it outright. Authorization instead comes
 * from the one-time `state` value round-tripped through Google (see
 * connections.service.ts's startGoogleCalendarOAuth/completeGoogleCalendarOAuth).
 */
export const googleCalendarOAuthRouter = Router();

// The first configured CORS origin is treated as the deployed frontend's
// base URL — this app has exactly one frontend deployment, so there's no
// separate "public site URL" setting to read instead.
const frontendBaseUrl = corsOrigins[0] ?? "/";

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

googleCalendarOAuthRouter.get(
  "/oauth/callback",
  asyncHandler(async (req, res) => {
    const { code, state, error } = parseQuery(callbackQuerySchema, req.query);
    if (error || !code || !state) {
      res.redirect(`${frontendBaseUrl}/admin?calendar=error&message=${encodeURIComponent(error ?? "Connection was cancelled.")}`);
      return;
    }
    const result = await completeGoogleCalendarOAuth(code, state);
    if (result.ok) {
      res.redirect(`${frontendBaseUrl}/admin?calendar=connected`);
    } else {
      res.redirect(`${frontendBaseUrl}/admin?calendar=error&message=${encodeURIComponent(result.error)}`);
    }
  }),
);
