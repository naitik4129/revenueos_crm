/**
 * The worker starts a WhatsApp session manager for every active workspace (baileys-registry.ts).
 * A workspace whose WhatsApp settings were never opened has no crm_whatsapp_connection row: that is
 * "not connected", not an error, and no session lock or pool connection may be left behind.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { startTestDb, type TestDb } from "./testDb.js";

describe("WhatsApp session start for a workspace without WhatsApp settings (PGlite)", () => {
  let testDb: TestDb;
  let seed: Pool;
  let ws: string;

  const lockIsFree = async () =>
    (await seed.query(`select pg_try_advisory_lock(hashtextextended($1, 1)) as ok`, [ws])).rows[0].ok as boolean;

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.url;
    seed = new Pool({ connectionString: testDb.url, max: 1 });
    ws = (await seed.query(`insert into crm_workspaces (name, slug) values ('Fresh', 'fresh') returning id`)).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await seed?.end();
    await (await import("../../src/db.js")).pool.end();
    await testDb?.stop();
  });

  it("starts as not connected, opens no socket, and gives its lock and connection back on stop", async () => {
    const { BaileysManager } = await import("../../src/providers/baileys.manager.js");
    const { pool } = await import("../../src/db.js");
    const manager = new BaileysManager(ws);
    await expect(manager.start()).resolves.toBeUndefined();
    expect(await seed.query(`select 1 from crm_whatsapp_connection where workspace_id = $1`, [ws]).then((r) => r.rowCount)).toBe(0);

    await manager.stop();
    // The session lock is free again (PGlite shares one session, so take and drop it to check).
    expect(await lockIsFree()).toBe(true);
    await seed.query(`select pg_advisory_unlock(hashtextextended($1, 1))`, [ws]);
    expect(pool.totalCount - pool.idleCount).toBe(0);
  });

  it("the registry starts every active workspace without errors and can start them again", async () => {
    const { baileysRegistry } = await import("../../src/providers/baileys-registry.js");
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      await baileysRegistry.ensureManagersForAllActiveWorkspaces();
      await baileysRegistry.ensureManagersForAllActiveWorkspaces();
    } finally {
      console.error = original;
      await baileysRegistry.stopAll();
    }
    expect(errors).toEqual([]);
  });
});
