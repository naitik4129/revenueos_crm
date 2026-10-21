import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { errorMiddleware } from "../../src/errorMiddleware.js";

function send(err: unknown) {
  const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const fake = {
    status: (code: number) => ((res.statusCode = code), fake),
    json: (body: unknown) => ((res.body = body), fake),
    setHeader: (k: string, v: string) => ((res.headers[k] = v), fake),
  };
  errorMiddleware(err, {} as Request, fake as unknown as Response, () => undefined);
  return res;
}

describe("errorMiddleware: a busy database is 503, not 500", () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  it("no free pool connection in time -> 503 with Retry-After", () => {
    const res = send(new Error("timeout exceeded when trying to connect"));
    expect(res.statusCode).toBe(503);
    expect(res.headers["Retry-After"]).toBe("5");
    expect(res.body).toEqual({ error: { code: "service_unavailable", message: "The server is busy. Please try again in a few seconds." } });
  });

  it("statement_timeout (57014) -> 503; other database errors stay 500", () => {
    expect(send(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })).statusCode).toBe(503);
    expect(send(Object.assign(new Error("duplicate key"), { code: "23505" })).statusCode).toBe(500);
  });
});
