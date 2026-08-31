import "dotenv/config";
import { z } from "zod";

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
});

// WORKER_* tuning is validated separately in workerEnv.ts. Provider secrets
// are loaded from encrypted database configuration, with optional legacy
// Resend environment values used only as a read-only fallback.

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration. See .env.example.");
  }
  return parsed.data;
}

export const env = loadEnv();

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
