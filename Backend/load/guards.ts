/**
 * LOAD TEST ONLY. The harness drops and rebuilds the crm schema, so it runs only on a local
 * database named crm_load. Never on Supabase or any other host.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export const LOAD_DB_NAME = "crm_load";

/** Why the harness must not run against this connection string, or null when it may. */
export function loadDbError(raw: string | undefined, nodeEnv: string | undefined): string | null {
  if (nodeEnv === "production") return "NODE_ENV=production: the load test never runs in production.";
  if (!raw) return "LOAD_DB_URL is not set (Backend/.env or the shell).";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "LOAD_DB_URL is not a valid URL.";
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return "LOAD_DB_URL must be a postgres:// URL.";
  if (!LOOPBACK.has(url.hostname)) return `LOAD_DB_URL must point at this machine (localhost), not ${url.hostname}.`;
  if (url.pathname !== `/${LOAD_DB_NAME}`) return `LOAD_DB_URL must name the database ${LOAD_DB_NAME}.`;
  return null;
}
