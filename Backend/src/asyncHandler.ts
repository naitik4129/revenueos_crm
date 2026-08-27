import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Wraps an async Express handler so a rejected promise reaches errorMiddleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
