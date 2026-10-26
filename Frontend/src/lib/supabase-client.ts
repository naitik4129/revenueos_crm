import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;
const apiBaseUrl = import.meta.env["VITE_API_BASE_URL"] as string | undefined;

const missing = [
  !url && "VITE_SUPABASE_URL",
  !anonKey && "VITE_SUPABASE_ANON_KEY",
  !apiBaseUrl && "VITE_API_BASE_URL",
].filter(Boolean) as string[];

export const configurationError = missing.length
  ? `Missing frontend configuration: ${missing.join(", ")}.`
  : null;
// backend-client.ts appends "/api/v1" to this base itself, so strip any
// trailing "/api" or "/api/v1" a misconfigured env var might already include
// (a common mistake when the value is copied from the backend's own API URL)
// to avoid doubling it into "/api/api/v1/...".
export const backendBaseUrl = apiBaseUrl?.replace(/\/$/, "").replace(/\/api(\/v1)?$/, "") ?? null;
// Cookie-backed (not localStorage): when the CRM is served on the same origin as the RevenueOS
// platform, both use @supabase/ssr and share the one `sb-<ref>-auth-token` cookie — so a user
// already signed in on the platform is signed in here too, with no second login.
export const supabase: SupabaseClient | null =
  url && anonKey ? createBrowserClient(url, anonKey) : null;
