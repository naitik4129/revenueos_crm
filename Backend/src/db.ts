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
//
// Busy pool: the API waits at most 5 s for a connection, then answers 503 (errorMiddleware); the
// worker waits up to 30 s (nobody is waiting on it). Any statement over 15 s is cancelled.
const isWorker = process.env.CRM_PROCESS === "worker";
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: isWorker ? env.WORKER_DB_POOL_MAX : env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: isWorker ? 30_000 : 5_000,
  statement_timeout: 15_000,
});

/** pg-pool's error when no connection frees up within connectionTimeoutMillis. */
export const isPoolTimeout = (err: unknown) => err instanceof Error && err.message === "timeout exceeded when trying to connect";
/** Postgres cancelled the statement (statement_timeout). */
export const isStatementTimeout = (err: unknown) => (err as { code?: string } | null)?.code === "57014";

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
