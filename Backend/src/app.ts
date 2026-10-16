import express from "express";
import cors from "cors";
import helmet from "helmet";
import { corsOrigins } from "./env.js";
import { apiRouter } from "./routes/index.js";
import { errorMiddleware, notFoundMiddleware } from "./errorMiddleware.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  );
  // Brain batches (up to 500 items, with call transcripts) need more room than user requests.
  app.use("/api/v1/brain", express.json({ limit: "25mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/v1", apiRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
