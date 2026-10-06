import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { parseBody } from "../validation/parse.js";
import * as connections from "../services/connections.service.js";
import * as websiteLeadSettings from "../services/websiteLeadSettings.service.js";
import { sendEmail } from "../providers/email.provider.js";
import { withTransaction } from "../db.js";
import { recordAdminAudit } from "../services/admin-audit.service.js";

/**
 * Workspace-scoped Email/WhatsApp/Google Calendar connection management.
 * Moved out of the admin-only app (see admin.routes.ts) per the
 * multi-workspace architecture plan: Admin stays limited to user
 * management, and every active salesperson can configure the connections
 * for whichever workspace they currently have selected (requireWorkspace,
 * applied at the crmRouter level in routes/index.ts, resolves req.workspaceId).
 */
export const connectionsRouter = Router();

connectionsRouter.get("/email", asyncHandler(async (req, res) => res.json(await connections.getEmailConnection(req.workspaceId!))));

const emailSchema = z.object({
  provider: z.enum(["resend", "smtp"]),
  enabled: z.boolean(),
  senderName: z.string().trim().min(1),
  senderAddress: z.string().email(),
  resendApiKey: z.string().optional(),
  smtpHost: z.string().trim().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecurity: z.enum(["tls", "starttls"]).optional(),
  smtpUsername: z.string().optional(),
  smtpPassword: z.string().optional(),
});
connectionsRouter.put(
  "/email",
  asyncHandler(async (req, res) =>
    res.json(await connections.updateEmailConnection(req.actor!, req.workspaceId!, parseBody(emailSchema, req.body))),
  ),
);

const emailTestSchema = z.object({ to: z.string().email() });
connectionsRouter.post(
  "/email/test",
  asyncHandler(async (req, res) => {
    const { to } = parseBody(emailTestSchema, req.body);
    const workspaceId = req.workspaceId!;
    try {
      const result = await sendEmail(
        workspaceId,
        { to, subject: "CRM email connection test", html: "<p>Your CRM email connection is working.</p>" },
        { allowDisabled: true },
      );
      await withTransaction((db) => recordAdminAudit(db, req.actor!, "connection.email.test_succeeded", "integration_connection", `${workspaceId}:email`, { to }));
      res.json({ ok: true, providerMessageId: result.providerMessageId });
    } catch (error) {
      await withTransaction((db) => recordAdminAudit(db, req.actor!, "connection.email.test_failed", "integration_connection", `${workspaceId}:email`, { to }));
      throw error;
    }
  }),
);

// Who owns leads that arrive from the public website form (Settings -> Website leads).
connectionsRouter.get(
  "/website-leads",
  asyncHandler(async (req, res) => res.json(await websiteLeadSettings.getWebsiteLeadSettings(req.workspaceId!))),
);
const websiteLeadsSchema = z.object({ defaultOwnerId: z.string().uuid().nullable() });
connectionsRouter.put(
  "/website-leads",
  asyncHandler(async (req, res) =>
    res.json(await websiteLeadSettings.updateWebsiteLeadSettings(req.actor!, req.workspaceId!, parseBody(websiteLeadsSchema, req.body))),
  ),
);

connectionsRouter.get(
  "/whatsapp/settings",
  asyncHandler(async (req, res) => res.json(await connections.getWhatsAppConnection(req.workspaceId!))),
);
const whatsappSettingsSchema = z.object({
  enabled: z.boolean(),
  dailyCap: z.number().int().min(1).max(10_000),
});
connectionsRouter.put(
  "/whatsapp/settings",
  asyncHandler(async (req, res) =>
    res.json(await connections.updateWhatsAppSettings(req.actor!, req.workspaceId!, parseBody(whatsappSettingsSchema, req.body))),
  ),
);

for (const command of ["connect", "restart", "logout"] as const) {
  connectionsRouter.post(
    `/whatsapp/${command}`,
    asyncHandler(async (req, res) => res.json(await connections.commandWhatsApp(req.actor!, req.workspaceId!, command))),
  );
}

connectionsRouter.get(
  "/google-calendar",
  asyncHandler(async (req, res) => res.json(await connections.getGoogleCalendarConnection(req.workspaceId!))),
);
const googleCalendarCredentialsSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().optional(),
  redirectUri: z.string().trim().url(),
});
connectionsRouter.put(
  "/google-calendar/credentials",
  asyncHandler(async (req, res) =>
    res.json(await connections.updateGoogleCalendarCredentials(req.actor!, req.workspaceId!, parseBody(googleCalendarCredentialsSchema, req.body))),
  ),
);
connectionsRouter.post(
  "/google-calendar/oauth/start",
  asyncHandler(async (req, res) => res.json(await connections.startGoogleCalendarOAuth(req.actor!, req.workspaceId!))),
);
connectionsRouter.post(
  "/google-calendar/disconnect",
  asyncHandler(async (req, res) => res.json(await connections.disconnectGoogleCalendar(req.actor!, req.workspaceId!))),
);
