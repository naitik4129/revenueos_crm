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
import { requireAuth, requireSalesperson } from "../authMiddleware.js";

export const apiRouter = Router();

apiRouter.use("/me", meRouter);
apiRouter.use("/admin", adminRouter);

const crmRouter = Router();
crmRouter.use(requireAuth, requireSalesperson);
crmRouter.use("/profiles", profilesRouter);
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
apiRouter.use(crmRouter);
