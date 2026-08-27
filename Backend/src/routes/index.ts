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
import { automationRouter } from "./automation.routes.js";

export const apiRouter = Router();

apiRouter.use("/me", meRouter);
apiRouter.use("/profiles", profilesRouter);
apiRouter.use("/leads", leadsRouter);
apiRouter.use("/tasks", tasksRouter);
apiRouter.use("/meetings", meetingsRouter);
apiRouter.use("/proposals", proposalsRouter);
apiRouter.use("/workflows", workflowsRouter);
apiRouter.use("/templates", templatesRouter);
apiRouter.use("/runs", runsRouter);
apiRouter.use("/scheduled-actions", scheduledActionsRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/automation", automationRouter);
