/**
 * The worker starts a WhatsApp session manager only for workspaces that ask to be connected
 * (baileys-registry.ts): a crm_whatsapp_connection row exists with desired_state <> 'disconnected'.
 * A workspace whose WhatsApp settings were never opened has no row, and a disconnected one does not
 * want a session — neither may have a manager started for it, because start() pins a pool connection
 * (the advisory lock) for the manager's whole life. Pinning one for sessions nobody wants starved the
 * worker's pool (brain-feed + queries) of connections.
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

  it("does not start a manager for a workspace that is not asking to connect, and pins no pool connection", async () => {
    const { baileysRegistry } = await import("../../src/providers/baileys-registry.js");
    const { pool } = await import("../../src/db.js");
    // A second active workspace that explicitly does not want a session.
    const off = (await seed.query(`insert into crm_workspaces (name, slug) values ('Off', 'off') returning id`)).rows[0].id as string;
    await seed.query(
      `insert into crm_whatsapp_connection (workspace_id, enabled, desired_state, status) values ($1, false, 'disconnected', 'disconnected')`,
      [off],
    );

    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      // 'Fresh' (no row) and 'Off' (disconnected) are both active but neither wants a session.
      await baileysRegistry.ensureManagersForAllActiveWorkspaces();
      await baileysRegistry.ensureManagersForAllActiveWorkspaces();
    } finally {
      console.error = original;
      await baileysRegistry.stopAll();
    }
    expect(errors).toEqual([]);
    expect(baileysRegistry.getExistingManager(ws)).toBeUndefined();
    expect(baileysRegistry.getExistingManager(off)).toBeUndefined();
    // No session started -> advisory lock free and no connection pinned out of the pool.
    expect(await lockIsFree()).toBe(true);
    await seed.query(`select pg_advisory_unlock(hashtextextended($1, 1))`, [ws]);
    expect(pool.totalCount - pool.idleCount).toBe(0);
  });
});
