import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAdmin, requireAuth } from "../authMiddleware.js";
import { parseBody, parseParams } from "../validation/parse.js";
import * as users from "../services/admin-users.service.js";
import * as connections from "../services/connections.service.js";
import { sendEmail } from "../providers/email.provider.js";
import { withTransaction } from "../db.js";
import { recordAdminAudit } from "../services/admin-audit.service.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/users", asyncHandler(async (_req, res) => res.json({ data: await users.listSalespeople() })));

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(12),
});
adminRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    const user = await users.createSalesperson(req.actor!, parseBody(createUserSchema, req.body));
    res.status(201).json(user);
  }),
);

const updateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(12).optional(),
  active: z.boolean().optional(),
});
adminRouter.patch(
  "/users",
  asyncHandler(async (req, res) => res.json(await users.updateSalesperson(req.actor!, parseBody(updateUserSchema, req.body)))),
);
const userIdParamsSchema = z.object({ id: z.string().uuid() });
adminRouter.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const { id } = parseParams(userIdParamsSchema, req.params);
    const input = parseBody(updateUserSchema.omit({ id: true }), req.body);
    res.json(await users.updateSalesperson(req.actor!, { id, ...input }));
  }),
);

adminRouter.get("/connections/email", asyncHandler(async (_req, res) => res.json(await connections.getEmailConnection())));

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
adminRouter.put(
  "/connections/email",
  asyncHandler(async (req, res) => res.json(await connections.updateEmailConnection(req.actor!, parseBody(emailSchema, req.body)))),
);

const emailTestSchema = z.object({ to: z.string().email() });
adminRouter.post(
  "/connections/email/test",
  asyncHandler(async (req, res) => {
    const { to } = parseBody(emailTestSchema, req.body);
    try {
      const result = await sendEmail(
        { to, subject: "CRM email connection test", html: "<p>Your CRM email connection is working.</p>" },
        { allowDisabled: true },
      );
      await withTransaction((db) => recordAdminAudit(db, req.actor!, "connection.email.test_succeeded", "integration_connection", "email", { to }));
      res.json({ ok: true, providerMessageId: result.providerMessageId });
    } catch (error) {
      await withTransaction((db) => recordAdminAudit(db, req.actor!, "connection.email.test_failed", "integration_connection", "email", { to }));
      throw error;
    }
  }),
);

adminRouter.get("/connections/whatsapp/settings", asyncHandler(async (_req, res) => res.json(await connections.getWhatsAppConnection())));
const whatsappSettingsSchema = z.object({
  enabled: z.boolean(),
  dailyCap: z.number().int().min(1).max(10_000),
});
adminRouter.put(
  "/connections/whatsapp/settings",
  asyncHandler(async (req, res) => res.json(await connections.updateWhatsAppSettings(req.actor!, parseBody(whatsappSettingsSchema, req.body)))),
);

for (const command of ["connect", "restart", "logout"] as const) {
  adminRouter.post(
    `/connections/whatsapp/${command}`,
    asyncHandler(async (req, res) => res.json(await connections.commandWhatsApp(req.actor!, command))),
  );
}

adminRouter.get(
  "/connections/google-calendar",
  asyncHandler(async (_req, res) => res.json(await connections.getGoogleCalendarConnection())),
);
const googleCalendarCredentialsSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().optional(),
  redirectUri: z.string().trim().url(),
});
adminRouter.put(
  "/connections/google-calendar/credentials",
  asyncHandler(async (req, res) =>
    res.json(await connections.updateGoogleCalendarCredentials(req.actor!, parseBody(googleCalendarCredentialsSchema, req.body))),
  ),
);
adminRouter.post(
  "/connections/google-calendar/oauth/start",
  asyncHandler(async (req, res) => res.json(await connections.startGoogleCalendarOAuth(req.actor!))),
);
adminRouter.post(
  "/connections/google-calendar/disconnect",
  asyncHandler(async (req, res) => res.json(await connections.disconnectGoogleCalendar(req.actor!))),
);
