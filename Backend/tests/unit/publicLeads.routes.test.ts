import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorMiddleware, notFoundMiddleware } from "../../src/errorMiddleware.js";
import { createPublicLeadsRouter } from "../../src/routes/publicLeads.routes.js";

// Only the paths that are decided before any database access are exercised
// here (auth, size guard, body shape). The full create/duplicate behaviour is
// covered by tests/integration/leadIngest.test.ts.
const KEY = "a".repeat(40);

describe("POST /api/v1/public/leads (pre-database guards)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/v1/public", createPublicLeadsRouter({ apiKey: KEY, workspaceId: "00000000-0000-0000-0000-000000000001" }));
    app.use(notFoundMiddleware);
    app.use(errorMiddleware);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/public/leads`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(base, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("rejects a request with no key", async () => {
    const res = await post({ name: "A", email: "a@example.com" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("authentication_failed");
  });

  it("rejects a wrong key", async () => {
    const res = await post({}, { "X-Ingest-Key": "b".repeat(40) });
    expect(res.status).toBe(401);
  });

  it("rejects an oversized body even with a valid key", async () => {
    const res = await post({ message: "x".repeat(40 * 1024) }, { "X-Ingest-Key": KEY });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
  });

  it("rejects a JSON body that is not an object", async () => {
    const res = await post(["not", "an", "object"], { "X-Ingest-Key": KEY });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_input");
  });

  it("only answers POST", async () => {
    const res = await fetch(base, { method: "GET", headers: { "X-Ingest-Key": KEY } });
    expect(res.status).toBe(404);
  });
});
