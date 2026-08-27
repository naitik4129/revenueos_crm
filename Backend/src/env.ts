import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  CORS_ORIGINS: z.string().default("http://localhost:8080"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  // Shared secret for the n8n automation executor (see serviceAuthMiddleware.ts).
  // Machine-to-machine only — never issued to a salesperson, never a Supabase
  // session. Generate with e.g. `openssl rand -hex 32`.
  N8N_SERVICE_API_KEY: z.string().min(32, "N8N_SERVICE_API_KEY must be a random secret of at least 32 characters"),
  // Optional "wake n8n now" push (see src/services/n8nWake.ts and
  // n8n/README.md §6). Purely a latency optimization on top of Workflow
  // 01's own 1-minute poll, which remains the source of truth — leaving
  // these unset just means slightly higher latency, never broken automation.
  N8N_WAKE_WEBHOOK_URL: z.string().url().optional(),
  N8N_WAKE_WEBHOOK_SECRET: z.string().min(16).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

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
