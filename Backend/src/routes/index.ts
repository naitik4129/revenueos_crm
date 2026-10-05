import { Router } from "express";
import { leadsRouter } from "./leads.routes.js";
import { tasksRouter } from "./tasks.routes.js";
import { meetingsRouter } from "./meetings.routes.js";
import { proposalsRouter } from "./proposals.routes.js";
import { workflowsRouter, templatesRouter } from "./workflows.routes.js";
import { runsRouter, scheduledActionsRouter } from "./runs.routes.js";
import { dashboardRouter } from "./dashboard.routes.js";
import { notificationsRouter } from "./notifications.routes.js";
import { meRouter, profilesRouter } from "./me.routes.js";
import { adminRouter } from "./admin.routes.js";
import { workspacesRouter } from "./workspaces.routes.js";
import { connectionsRouter } from "./connections.routes.js";
import { googleCalendarOAuthRouter } from "./googleCalendarOAuth.routes.js";
import { createPublicLeadsRouter } from "./publicLeads.routes.js";
import { env } from "../env.js";
import { requireAuth, requireSalesperson, requireWorkspace } from "../authMiddleware.js";

export const apiRouter = Router();

apiRouter.use("/me", meRouter);
// Mounted before adminRouter so Google's unauthenticated OAuth redirect
// reaches this specific, unauthenticated route rather than being rejected
// by adminRouter's blanket requireAuth — every other /admin/... path falls
// through untouched since this router only defines /oauth/callback. It
// can't carry an X-Workspace-Id header (Google's browser redirect carries
// no custom headers either), so the workspace is instead recovered from
// which workspace's connection row has the matching pending_oauth_state —
// see connections.service.ts's completeGoogleCalendarOAuth.
apiRouter.use("/connections/google-calendar", googleCalendarOAuthRouter);

// Public website-form lead intake. Must be mounted before profilesAccessRouter
// and crmRouter below: both attach requireAuth at the router root, so anything
// reaching them unauthenticated would be rejected. Authenticates with its own
// shared-secret header instead, and only exists when explicitly configured.
if (env.INGEST_API_KEY && env.INGEST_WORKSPACE_ID) {
  apiRouter.use("/public", createPublicLeadsRouter({ apiKey: env.INGEST_API_KEY, workspaceId: env.INGEST_WORKSPACE_ID }));
}

apiRouter.use("/admin", adminRouter);

// /workspaces is deliberately mounted before crmRouter's requireWorkspace:
// the workspace list must be fetchable before the frontend has one selected
// to send as X-Workspace-Id.
apiRouter.use("/workspaces", workspacesRouter);

// /profiles is salesperson-gated but intentionally NOT workspace-gated: the
// user directory is the same across every workspace (there is no
// per-workspace membership), and the frontend fetches it alongside the
// workspace list itself, before a workspace is necessarily selected yet.
const profilesAccessRouter = Router();
profilesAccessRouter.use(requireAuth, requireSalesperson);
profilesAccessRouter.use("/profiles", profilesRouter);
apiRouter.use(profilesAccessRouter);

const crmRouter = Router();
crmRouter.use(requireAuth, requireSalesperson, requireWorkspace);
crmRouter.use("/leads", leadsRouter);
crmRouter.use("/tasks", tasksRouter);
crmRouter.use("/meetings", meetingsRouter);
crmRouter.use("/proposals", proposalsRouter);
crmRouter.use("/workflows", workflowsRouter);
crmRouter.use("/templates", templatesRouter);
crmRouter.use("/runs", runsRouter);
crmRouter.use("/scheduled-actions", scheduledActionsRouter);
crmRouter.use("/dashboard", dashboardRouter);
crmRouter.use("/notifications", notificationsRouter);
crmRouter.use("/connections", connectionsRouter);
apiRouter.use(crmRouter);
