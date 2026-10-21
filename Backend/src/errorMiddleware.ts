import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errors.js";
import { env } from "./env.js";
import { isPoolTimeout, isStatementTimeout } from "./db.js";

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({ error: { code: "not_found", message: `No route: ${req.method} ${req.path}` } });
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (isPoolTimeout(err) || isStatementTimeout(err)) {
    console.warn(`[db] ${isPoolTimeout(err) ? "No free database connection within 5 s" : "Statement cancelled after 15 s"}: answered 503.`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: { code: "service_unavailable", message: "The server is busy. Please try again in a few seconds." } });
    return;
  }

  const message = err instanceof Error ? err.message : "Internal server error.";
  if (env.NODE_ENV !== "test") {
    console.error("Unhandled error:", err);
  }
  res.status(500).json({
    error: {
      code: "internal_error",
      message: env.NODE_ENV === "production" ? "Internal server error." : message,
    },
  });
}
