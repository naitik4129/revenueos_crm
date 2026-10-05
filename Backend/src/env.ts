import "dotenv/config";
import { z } from "zod";

// A blank `KEY=` line in .env arrives as "" — treat it as "not set".
const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  CORS_ORIGINS: z.string().default("http://localhost:8080,http://127.0.0.1:8080"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  INTEGRATION_ENCRYPTION_KEY: z.string().refine(
    (value) => {
      try {
        return Buffer.from(value, "base64").length === 32;
      } catch {
        return false;
      }
    },
    "INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
  ),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // The platform's own Google OAuth app, shared by every workspace so users
  // connect Google Calendar with one click instead of registering their own
  // client. All three must be set together (checked in loadEnv).
  GOOGLE_OAUTH_CLIENT_ID: blankToUndefined(z.string().optional()),
  GOOGLE_OAUTH_CLIENT_SECRET: blankToUndefined(z.string().optional()),
  GOOGLE_OAUTH_REDIRECT_URI: blankToUndefined(z.string().url().optional()),

  // Public website-form lead intake (POST /api/v1/public/leads). Both must be
  // set together or the endpoint stays disabled (checked in loadEnv). The key
  // is a shared secret held only by the website's server; it is bound to the
  // one workspace named here.
  INGEST_API_KEY: blankToUndefined(z.string().min(32, "INGEST_API_KEY must be at least 32 characters").optional()),
  INGEST_WORKSPACE_ID: blankToUndefined(z.string().uuid().optional()),
});

// WORKER_* tuning is validated separately in workerEnv.ts. Provider secrets
// (Resend, etc.) are loaded from encrypted database configuration, entered
// by an admin in Admin -> Connections — never from environment variables —
// with only email having an optional legacy Resend environment fallback.
// Google Calendar is the exception: the platform-wide OAuth app lives in the
// GOOGLE_OAUTH_* variables above, and a workspace can still override it with
// its own client saved (encrypted) in the database.

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration. See .env.example.");
  }
  const googleVars = [
    parsed.data.GOOGLE_OAUTH_CLIENT_ID,
    parsed.data.GOOGLE_OAUTH_CLIENT_SECRET,
    parsed.data.GOOGLE_OAUTH_REDIRECT_URI,
  ];
  if (googleVars.some(Boolean) && !googleVars.every(Boolean)) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI must all be set together. See .env.example.",
    );
  }
  if (Boolean(parsed.data.INGEST_API_KEY) !== Boolean(parsed.data.INGEST_WORKSPACE_ID)) {
    throw new Error("INGEST_API_KEY and INGEST_WORKSPACE_ID must both be set, or both left blank. See .env.example.");
  }
  return parsed.data;
}

export const env = loadEnv();

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
