import pg, { Pool, type PoolClient } from "pg";
import { env } from "./env.js";

// Postgres `date` (OID 1082) stays a "YYYY-MM-DD" string. Parsed into a JS Date it becomes local
// midnight, and toISOString() then shifts it to the previous day east of UTC (e.g. Asia/Kolkata).
pg.types.setTypeParser(1082, (value) => value);

// Single pool for the whole process. Supabase's pooled connection strings
// (pgbouncer) are fine here too, but transactions (BEGIN/COMMIT) require a
// single dedicated connection per transaction, which is exactly what
// pool.connect() + client.query gives us below — pool.query() alone would
// not guarantee the same underlying connection across statements.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/**
 * Runs `fn` inside a single Postgres transaction: BEGIN, then either COMMIT
 * (fn resolved) or ROLLBACK (fn threw), always releasing the client back to
 * the pool. This is how every business operation that touches more than one
 * table stays atomic (Rule 16: either the whole business change lands, or
 * none of it does).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type DbClient = PoolClient;
