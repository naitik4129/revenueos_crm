import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
export const backendBaseUrl = apiBaseUrl?.replace(/\/$/, "") ?? null;
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;
