import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase auth is an additive, opt-in layer on top of the existing mock
// app: until VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are configured, the
// app behaves exactly as it did before (no login wall, pure mock data) —
// see routes/__root.tsx's AuthGate. This lets the migration land without
// breaking the out-of-the-box mock experience for anyone who hasn't set up
// a Supabase project yet.
const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
