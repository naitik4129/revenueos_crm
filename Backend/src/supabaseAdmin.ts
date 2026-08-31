import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Server-only Supabase client used for bearer-token verification and the
 * explicitly admin-authorized Auth user lifecycle endpoints. CRM business
 * tables still go through the direct Postgres pool so multi-table writes can
 * use real transactions.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
