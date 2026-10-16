/** DEMO MODE ONLY. The checks that keep demo mode away from real data and real providers. */

type Env = Record<string, string | undefined>;

/** Demo mode runs only when asked for explicitly, in development, with no database of its own. */
export function demoStartError(env: Env): string | null {
  if (env.DEMO_MODE !== "true" || env.NODE_ENV !== "development") {
    return "Demo mode needs DEMO_MODE=true and NODE_ENV=development. Start it with `npm run demo`.";
  }
  if (env.DATABASE_URL) {
    return "DATABASE_URL is set in this shell. Demo mode only runs on its own local PGlite database: unset DATABASE_URL and try again.";
  }
  return null;
}

/** Variables demo mode blanks before Backend/.env loads (dotenv never overrides a set variable). */
export const BLANKED_PROVIDER_VARS = [
  "RESEND_API_KEY",
  "SMTP_FROM_ADDRESS",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
] as const;

const isLoopback = (raw: string, port: number) => {
  try {
    const url = new URL(raw);
    return url.hostname === "127.0.0.1" && Number(url.port) === port;
  } catch {
    return false;
  }
};

/**
 * Checked again after the backend's env.ts has loaded: the database must be the PGlite this
 * process started, auth must be the local fake, and no provider key may have come through.
 */
export function demoRuntimeError(
  loaded: { DATABASE_URL: string; SUPABASE_URL: string },
  env: Env,
  ports: { pglite: number; fakeSupabase: number },
): string | null {
  if (!isLoopback(loaded.DATABASE_URL, ports.pglite)) return `Refusing to start: DATABASE_URL is not the local demo PGlite (${loaded.DATABASE_URL}).`;
  if (!isLoopback(loaded.SUPABASE_URL, ports.fakeSupabase)) return `Refusing to start: SUPABASE_URL is not the local demo auth (${loaded.SUPABASE_URL}).`;
  const leaked = BLANKED_PROVIDER_VARS.filter((name) => env[name]);
  if (leaked.length) return `Refusing to start: provider settings are set (${leaked.join(", ")}).`;
  return null;
}
