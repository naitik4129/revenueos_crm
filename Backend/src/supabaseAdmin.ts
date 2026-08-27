import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Admin-privileged Supabase client used for exactly one thing: verifying a
 * bearer access token presented by the frontend (supabase.auth.getUser).
 * It never touches CRM business tables — all business data access goes
 * through the direct Postgres pool (src/db.ts) so multi-table writes can be
 * wrapped in real transactions.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
